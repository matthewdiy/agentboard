import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { documentNodes } from "@/db/schema";
import { DocumentPathConflictError } from "./errors";
import { getDirectoryAncestors, maxPathDepth } from "./paths";
import type { Database, Transaction } from "./types";

export async function findFolderId(database: Database, path: string) {
  const [folder] = await database
    .select({ id: documentNodes.id })
    .from(documentNodes)
    .where(
      and(eq(documentNodes.path, path), eq(documentNodes.kind, "folder")),
    )
    .limit(1);
  return folder?.id ?? null;
}

/**
 * Documents and folders share one path namespace, so a new path is only free
 * when nothing occupies it and no ancestor path is already a document.
 */
export async function assertPathAvailable(
  tx: Transaction,
  path: string,
  excludeNodeId?: string,
) {
  const [existingNode] = await tx
    .select({ id: documentNodes.id })
    .from(documentNodes)
    .where(
      and(
        eq(documentNodes.path, path),
        excludeNodeId ? ne(documentNodes.id, excludeNodeId) : undefined,
      ),
    )
    .limit(1);
  if (existingNode) throw new DocumentPathConflictError(path);

  const ancestorPaths = getDirectoryAncestors(path);
  if (ancestorPaths.length === 0) return;

  const [blockingDocument] = await tx
    .select({ id: documentNodes.id })
    .from(documentNodes)
    .where(
      and(
        inArray(documentNodes.path, ancestorPaths),
        eq(documentNodes.kind, "document"),
      ),
    )
    .limit(1);
  if (blockingDocument) throw new DocumentPathConflictError(path);
}

/**
 * Creates every missing folder above `path`, parent first, and returns the id
 * of the direct parent (null for root-level paths).
 *
 * The conditional upsert is what makes this race-free: when the conflicting row
 * is a document rather than a folder the update matches nothing, no row is
 * returned, and the caller learns the ancestor path is taken by a document.
 */
export async function ensureFolderChain(tx: Transaction, path: string) {
  let parentId: string | null = null;

  for (const ancestorPath of getDirectoryAncestors(path)) {
    // The self-referencing foreign key makes Drizzle's insert inference
    // circular, so the returned row is annotated explicitly.
    const folders: Array<{ id: string }> = await tx
      .insert(documentNodes)
      .values({ kind: "folder", path: ancestorPath, parentId })
      .onConflictDoUpdate({
        target: documentNodes.path,
        set: {
          path: sql`excluded.path`,
          // Drizzle's conflict set applies $onUpdate to every update, which
          // would rewrite each ancestor on every upload. Re-assigning the
          // existing value keeps the common case a true no-op.
          updatedAt: sql`${documentNodes.updatedAt}`,
        },
        setWhere: eq(documentNodes.kind, "folder"),
      })
      .returning({ id: documentNodes.id });

    const folder = folders[0];
    if (!folder) throw new DocumentPathConflictError(ancestorPath);
    parentId = folder.id;
  }

  return parentId;
}

/**
 * Removes folders that became empty, walking up from `startParentId` until an
 * ancestor still has children. Bounded by the same nesting limit as paths.
 */
export async function pruneEmptyAncestors(
  tx: Transaction,
  startParentId: string | null,
) {
  let currentId = startParentId;

  for (let level = 0; currentId && level <= maxPathDepth; level += 1) {
    const [child] = await tx
      .select({ id: documentNodes.id })
      .from(documentNodes)
      .where(eq(documentNodes.parentId, currentId))
      .limit(1);
    if (child) return;

    const [removed] = await tx
      .delete(documentNodes)
      .where(
        and(
          eq(documentNodes.id, currentId),
          eq(documentNodes.kind, "folder"),
        ),
      )
      .returning({ parentId: documentNodes.parentId });
    if (!removed) return;
    currentId = removed.parentId;
  }
}
