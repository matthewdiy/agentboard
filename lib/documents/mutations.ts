import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { documentAssets, documentContents, documentNodes } from "@/db/schema";
import {
  buildAssetReferences,
  cleanupBlobs,
  insertAssets,
  writeBlobs,
} from "./assets";
import { DocumentPathConflictError, isPathUniqueViolation } from "./errors";
import { documentPathFromFilename, normalizeDocumentPath } from "./paths";
import {
  DocumentInputError,
  type ParsedDocumentUpload,
  normalizeDocumentTitle,
  renderDocument,
} from "./processing";
import { getDocument } from "./queries";
import {
  applyPathChange,
  readNodeSummary,
  withLockedDocument,
} from "./node-writes";
import { assertPathAvailable, ensureFolderChain, pruneEmptyAncestors } from "./tree";

function hashSource(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

// The six payload columns are only ever written together, so create and
// replace share one definition instead of duplicating the field list.
function documentPayload(upload: ParsedDocumentUpload, contentHash: string) {
  return {
    title: upload.title,
    sourceFormat: upload.format,
    sourceFilename: upload.filename,
    contentHash,
    sourceBytes: upload.sourceBytes,
  };
}

function resolveUploadPath(upload: ParsedDocumentUpload) {
  return normalizeDocumentPath(
    upload.path ?? documentPathFromFilename(upload.filename),
  );
}

export async function createDocument(upload: ParsedDocumentUpload) {
  const id = randomUUID();
  const path = resolveUploadPath(upload);
  const assetReferences = buildAssetReferences(id, upload);
  const sanitizedHtml = await renderDocument(
    upload.format,
    upload.source,
    assetReferences,
  );
  const now = new Date();

  try {
    await writeBlobs(assetReferences);
    await db.transaction(async (tx) => {
      await assertPathAvailable(tx, path);
      const parentId = await ensureFolderChain(tx, path);
      await tx.insert(documentNodes).values({
        id,
        kind: "document",
        parentId,
        path,
        ...documentPayload(upload, hashSource(upload.source)),
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(documentContents).values({
        nodeId: id,
        sourceContent: upload.source,
        sanitizedHtml,
      });
      await insertAssets(tx, id, assetReferences);
    });
  } catch (error) {
    await cleanupBlobs(assetReferences);
    if (isPathUniqueViolation(error)) {
      throw new DocumentPathConflictError(path);
    }
    throw error;
  }

  return getDocument(id);
}

export async function replaceDocument(
  id: string,
  upload: ParsedDocumentUpload,
) {
  const requestedPath = upload.path
    ? normalizeDocumentPath(upload.path)
    : undefined;
  const assetReferences = buildAssetReferences(id, upload);
  const sanitizedHtml = await renderDocument(
    upload.format,
    upload.source,
    assetReferences,
  );
  const now = new Date();
  let targetPath = requestedPath;

  try {
    await writeBlobs(assetReferences);
    const oldAssets = await db.transaction(async (tx) =>
      withLockedDocument(tx, id, async (node) => {
        const currentAssets = await tx
          .select()
          .from(documentAssets)
          .where(eq(documentAssets.nodeId, id));
        const path = requestedPath ?? node.path;
        targetPath = path;
        const change = await applyPathChange(tx, node, path);

        await tx
          .update(documentNodes)
          .set({
            path,
            parentId: change.parentId,
            ...documentPayload(upload, hashSource(upload.source)),
            updatedAt: now,
          })
          .where(eq(documentNodes.id, id));

        await tx
          .insert(documentContents)
          .values({
            nodeId: id,
            sourceContent: upload.source,
            sanitizedHtml,
          })
          .onConflictDoUpdate({
            target: documentContents.nodeId,
            set: { sourceContent: upload.source, sanitizedHtml },
          });

        await tx.delete(documentAssets).where(eq(documentAssets.nodeId, id));
        await insertAssets(tx, id, assetReferences);
        await pruneEmptyAncestors(tx, change.pruneParentId);

        return currentAssets;
      }),
    );

    if (!oldAssets) {
      await cleanupBlobs(assetReferences);
      return null;
    }

    await cleanupBlobs(oldAssets.map((asset) => ({ blobKey: asset.blobKey })));
  } catch (error) {
    await cleanupBlobs(assetReferences);
    if (isPathUniqueViolation(error)) {
      throw new DocumentPathConflictError(targetPath ?? requestedPath ?? "");
    }
    throw error;
  }

  return getDocument(id);
}

export type DocumentChanges = {
  path?: string;
  title?: string;
};

/**
 * Applies a move and/or a rename in one transaction. A rename deliberately
 * skips all tree work, so editing a title never rewrites ancestor folders.
 */
export async function updateDocument(id: string, changes: DocumentChanges) {
  const path =
    changes.path === undefined ? undefined : normalizeDocumentPath(changes.path);
  const title =
    changes.title === undefined ? undefined : normalizeDocumentTitle(changes.title);

  if (path === undefined && title === undefined) {
    throw new DocumentInputError("A document path or title is required.");
  }

  return db
    .transaction(async (tx) =>
      withLockedDocument(tx, id, async (node) => {
        const nextPath = path ?? node.path;
        const change =
          nextPath === node.path ? null : await applyPathChange(tx, node, nextPath);

        if (!change && title === undefined) return readNodeSummary(tx, id);

        await tx
          .update(documentNodes)
          .set({
            path: nextPath,
            parentId: change ? change.parentId : node.parentId,
            updatedAt: new Date(),
            ...(title === undefined ? {} : { title }),
          })
          .where(eq(documentNodes.id, id));

        if (change) await pruneEmptyAncestors(tx, change.pruneParentId);
        return readNodeSummary(tx, id);
      }),
    )
    .catch((error: unknown) => {
      if (isPathUniqueViolation(error)) {
        throw new DocumentPathConflictError(path ?? "");
      }
      throw error;
    });
}

export async function deleteDocument(id: string) {
  const deleted = await db.transaction(async (tx) =>
    withLockedDocument(tx, id, async (node) => {
      const assets = await tx
        .select()
        .from(documentAssets)
        .where(eq(documentAssets.nodeId, id));

      // Contents and asset rows are removed by the cascading foreign keys.
      const deletedRows = await tx
        .delete(documentNodes)
        .where(eq(documentNodes.id, id))
        .returning({ id: documentNodes.id });
      if (deletedRows.length === 0) return null;

      await pruneEmptyAncestors(tx, node.parentId);
      return assets;
    }),
  );

  if (!deleted) return false;
  await cleanupBlobs(deleted.map((asset) => ({ blobKey: asset.blobKey })));
  return true;
}
