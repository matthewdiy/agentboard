import { and, eq } from "drizzle-orm";

import { documentNodes } from "@/db/schema";
import { assertPathAvailable, ensureFolderChain } from "./tree";
import { documentSummarySelection, toSummary } from "./projections";
import type { Transaction } from "./types";

export type LockedNode = { id: string; path: string; parentId: string | null };
export type PathChange = { parentId: string | null; pruneParentId: string | null };

/**
 * Locks a document row and hands it to `run`, or resolves null when the
 * document does not exist. Centralised so every mutation gets the same
 * existence check and row lock.
 */
export async function withLockedDocument<T>(
  tx: Transaction,
  id: string,
  run: (node: LockedNode) => Promise<T>,
): Promise<T | null> {
  const [node] = await tx
    .select({
      id: documentNodes.id,
      path: documentNodes.path,
      parentId: documentNodes.parentId,
    })
    .from(documentNodes)
    .where(and(eq(documentNodes.id, id), eq(documentNodes.kind, "document")))
    .for("update")
    .limit(1);

  if (!node) return null;
  return run(node);
}

/**
 * Resolves the parent and cleanup work for a path change. An unchanged path
 * keeps its parent and needs no pruning.
 */
export async function applyPathChange(
  tx: Transaction,
  node: LockedNode,
  nextPath: string,
): Promise<PathChange> {
  if (nextPath === node.path) {
    return { parentId: node.parentId, pruneParentId: null };
  }

  await assertPathAvailable(tx, nextPath, node.id);
  const parentId = await ensureFolderChain(tx, nextPath);
  return { parentId, pruneParentId: node.parentId };
}

export async function readNodeSummary(tx: Transaction, id: string) {
  const [document] = await tx
    .select(documentSummarySelection)
    .from(documentNodes)
    .where(eq(documentNodes.id, id))
    .limit(1);
  return document ? toSummary(document) : null;
}
