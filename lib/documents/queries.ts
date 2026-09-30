import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNull,
  lt,
  or,
} from "drizzle-orm";

import { db } from "@/db";
import { documentAssets, documentContents, documentNodes } from "@/db/schema";
import {
  decodeListCursor,
  encodeListCursor,
  likePattern,
  normalizeTreeCursor,
  normalizeTreeParent,
  pageSize,
  validateQuery,
} from "./cursor";
import {
  documentSummarySelection,
  toDocumentResponse,
  toSummary,
  toTreeEntry,
} from "./projections";
import { findFolderId } from "./tree";
import type {
  DocumentListOptions,
  DocumentListPage,
  DocumentStats,
  DocumentTreeOptions,
  DocumentTreePage,
} from "./types";

const rootPath = "/";

export async function listDocuments(
  options: DocumentListOptions = {},
): Promise<DocumentListPage> {
  const limit = pageSize(options.limit);
  const query = validateQuery(options.query);
  const cursor = options.cursor ? decodeListCursor(options.cursor) : undefined;
  const pattern = query ? likePattern(query) : undefined;

  // Keyset pagination instead of OFFSET so later pages do not get slower as
  // the table grows or shift when newer documents are inserted.
  const rows = await db
    .select(documentSummarySelection)
    .from(documentNodes)
    .where(
      and(
        eq(documentNodes.kind, "document"),
        pattern
          ? or(
              ilike(documentNodes.title, pattern),
              ilike(documentNodes.path, pattern),
            )
          : undefined,
        cursor
          ? or(
              lt(documentNodes.updatedAt, cursor.updatedAt),
              and(
                eq(documentNodes.updatedAt, cursor.updatedAt),
                lt(documentNodes.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(documentNodes.updatedAt), desc(documentNodes.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    documents: visibleRows.map(toSummary),
    nextCursor: hasMore
      ? encodeListCursor(visibleRows[visibleRows.length - 1]!)
      : null,
  };
}

async function readTreePage(
  parentId: string | null,
  parentPath: string,
  cursor: string | undefined,
  limit: number,
): Promise<DocumentTreePage> {
  // Folders and documents share one table and one ordering, so direct children
  // come back from a single query with a cursor that matches the database
  // collation instead of being merged in application code.
  const rows = await db
    .select({ ...documentSummarySelection, kind: documentNodes.kind })
    .from(documentNodes)
    .where(
      and(
        parentId
          ? eq(documentNodes.parentId, parentId)
          : isNull(documentNodes.parentId),
        cursor ? gt(documentNodes.path, cursor) : undefined,
      ),
    )
    .orderBy(asc(documentNodes.path))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    parentPath,
    entries: visibleRows.map((row) => toTreeEntry(row, parentPath)),
    nextCursor: hasMore
      ? (visibleRows[visibleRows.length - 1]?.path ?? null)
      : null,
  };
}

export async function getDocumentTree(
  parentPath = rootPath,
  options: DocumentTreeOptions = {},
): Promise<DocumentTreePage> {
  const normalizedParentPath = normalizeTreeParent(parentPath);
  const limit = pageSize(options.limit);
  const cursor = options.cursor ? normalizeTreeCursor(options.cursor) : undefined;

  if (normalizedParentPath === rootPath) {
    return readTreePage(null, normalizedParentPath, cursor, limit);
  }

  const folderId = await findFolderId(db, normalizedParentPath);
  if (!folderId) {
    return { parentPath: normalizedParentPath, entries: [], nextCursor: null };
  }

  return readTreePage(folderId, normalizedParentPath, cursor, limit);
}

export async function getDocumentStats(): Promise<DocumentStats> {
  const [documentCountRows, folderCountRows, latestRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(documentNodes)
      .where(eq(documentNodes.kind, "document")),
    db
      .select({ value: count() })
      .from(documentNodes)
      .where(eq(documentNodes.kind, "folder")),
    db
      .select(documentSummarySelection)
      .from(documentNodes)
      .where(eq(documentNodes.kind, "document"))
      .orderBy(desc(documentNodes.updatedAt), desc(documentNodes.id))
      .limit(1),
  ]);

  return {
    documentCount: Number(documentCountRows[0]?.value ?? 0),
    folderCount: Number(folderCountRows[0]?.value ?? 0),
    latest: latestRows[0] ? toSummary(latestRows[0]) : null,
  };
}

export async function getDocumentSummary(id: string) {
  const [document] = await db
    .select(documentSummarySelection)
    .from(documentNodes)
    .where(and(eq(documentNodes.id, id), eq(documentNodes.kind, "document")))
    .limit(1);
  return document ? toSummary(document) : null;
}

export async function getDocument(id: string) {
  const [row] = await db
    .select({ node: documentNodes, content: documentContents })
    .from(documentNodes)
    .leftJoin(documentContents, eq(documentContents.nodeId, documentNodes.id))
    .where(and(eq(documentNodes.id, id), eq(documentNodes.kind, "document")))
    .limit(1);

  if (!row) return null;
  if (!row.content) {
    // Content is written in the same transaction as the node, so a missing row
    // is a data-integrity fault, not a missing document.
    throw new Error(`Document ${id} has no stored content.`);
  }

  // Assets are fetched separately because they are only needed for the full
  // document response, never for list or tree views.
  const assets = await db
    .select()
    .from(documentAssets)
    .where(eq(documentAssets.nodeId, id));

  return toDocumentResponse(row.node, row.content, assets);
}
