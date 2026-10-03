import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documentContents,
  documentNodes,
  documentShares,
} from "@/db/schema";
import { getAppUrl } from "@/lib/env";
import { getDocumentSummary } from "./queries";
import {
  generateShareToken,
  hashShareToken,
  looksLikeShareToken,
} from "./share-tokens";
import { toShareSummary, shareStatus } from "./shares";
import type {
  DocumentShareCreated,
  DocumentShareSummary,
  SharedDocument,
} from "./types";

/**
 * A document only ever accumulates a handful of links, so the list is bounded
 * rather than paginated.
 */
const maxListedShares = 100;

export type ShareLookup =
  | { kind: "active"; share: DocumentShareSummary; nodeId: string }
  | { kind: "expired" | "revoked"; share: DocumentShareSummary };

export function buildShareUrl(token: string) {
  return `${getAppUrl()}/s/${token}`;
}

/**
 * `now` is injectable because a link's status depends on the current time,
 * which would otherwise make this list untestable at a fixed clock.
 */
export async function listDocumentShares(
  nodeId: string,
  now = new Date(),
): Promise<DocumentShareSummary[]> {
  const rows = await db
    .select()
    .from(documentShares)
    .where(eq(documentShares.nodeId, nodeId))
    .orderBy(
      // Live links come first, so the capped window can only ever drop dead
      // ones: a permanent link must never be pushed out of the list by newer
      // expired links. Ordering has to happen in SQL because the limit is
      // applied before any row reaches JavaScript, and the injected clock
      // keeps this ordering on the same clock as the status computed below.
      desc(
        sql`(${documentShares.revokedAt} is null and (${documentShares.expiresAt} is null or ${documentShares.expiresAt} > ${now}))`,
      ),
      desc(documentShares.createdAt),
      desc(documentShares.id),
    )
    .limit(maxListedShares);

  return rows.map((row) => toShareSummary(row, now));
}

/**
 * Returns the raw token exactly once. Nothing else in the application can read
 * it again, because the row only holds its hash.
 *
 * A null `expiresAt` creates a link that never expires; only revocation ends it.
 */
export async function createDocumentShare(
  nodeId: string,
  { name, expiresAt }: { name: string | null; expiresAt: Date | null },
): Promise<DocumentShareCreated | null> {
  // Checking the node first reports an unknown document as 404 rather than
  // surfacing the foreign key violation.
  const document = await getDocumentSummary(nodeId);
  if (!document) return null;

  const token = generateShareToken();
  const [row] = await db
    .insert(documentShares)
    .values({ nodeId, name, tokenHash: hashShareToken(token), expiresAt })
    .returning();

  if (!row) throw new Error(`Share link for document ${nodeId} was not stored.`);

  return { share: toShareSummary(row), token, url: buildShareUrl(token) };
}

export async function revokeDocumentShare(
  nodeId: string,
  shareId: string,
): Promise<"revoked" | "already-revoked" | "missing"> {
  // Scoping by node_id means a link id belonging to another document cannot be
  // revoked through this document.
  const [existing] = await db
    .select()
    .from(documentShares)
    .where(
      and(eq(documentShares.id, shareId), eq(documentShares.nodeId, nodeId)),
    )
    .limit(1);

  if (!existing) return "missing";
  if (existing.revokedAt) return "already-revoked";

  await db
    .update(documentShares)
    .set({ revokedAt: new Date() })
    .where(eq(documentShares.id, shareId));

  return "revoked";
}

/**
 * Removes a link that no longer grants access, which is the only reason to
 * delete a row at all: revocation keeps the audit trail, and a purged link is
 * indistinguishable from one that never existed.
 *
 * A live link is refused rather than quietly revoked, so losing the record of
 * a link that was public is always a deliberate two-step.
 */
export async function deleteDocumentShare(
  nodeId: string,
  shareId: string,
  now = new Date(),
): Promise<"deleted" | "active" | "missing"> {
  const [existing] = await db
    .select()
    .from(documentShares)
    .where(
      and(eq(documentShares.id, shareId), eq(documentShares.nodeId, nodeId)),
    )
    .limit(1);

  if (!existing) return "missing";
  // Revocation is irreversible and expiry only moves forward, so a link that
  // reads as dead here cannot become live again before the delete lands.
  if (shareStatus(existing, now) === "active") return "active";

  await db.delete(documentShares).where(eq(documentShares.id, shareId));

  return "deleted";
}

export async function getShareByToken(
  token: string,
  now = new Date(),
): Promise<ShareLookup | null> {
  // Shape-checking first keeps malformed tokens, including anything a crawler
  // invents, from reaching the database.
  if (!looksLikeShareToken(token)) return null;

  const [row] = await db
    .select()
    .from(documentShares)
    .where(eq(documentShares.tokenHash, hashShareToken(token)))
    .limit(1);

  if (!row) return null;

  const share = toShareSummary(row, now);
  return share.status === "active"
    ? { kind: "active", share, nodeId: row.nodeId }
    : { kind: share.status, share };
}

/**
 * A single atomic increment, so concurrent views cannot lose a count.
 */
export async function recordShareAccess(shareId: string) {
  await db
    .update(documentShares)
    .set({
      viewCount: sql`${documentShares.viewCount} + 1`,
      lastAccessedAt: new Date(),
    })
    .where(eq(documentShares.id, shareId));
}

/**
 * The public projection of a document: only the columns the public page renders.
 * Selecting the column list, rather than reusing `getDocument()`, keeps the
 * original source text out of a public request entirely.
 */
export async function getSharedDocument(
  nodeId: string,
): Promise<SharedDocument | null> {
  const [row] = await db
    .select({
      title: documentNodes.title,
      sourceFormat: documentNodes.sourceFormat,
      sanitizedHtml: documentContents.sanitizedHtml,
      updatedAt: documentNodes.updatedAt,
    })
    .from(documentNodes)
    .innerJoin(documentContents, eq(documentContents.nodeId, documentNodes.id))
    .where(and(eq(documentNodes.id, nodeId), eq(documentNodes.kind, "document")))
    .limit(1);

  // Payload columns are nullable because folders share the table; the
  // kind_payload check guarantees a document row carries them.
  if (!row || row.title === null || row.sourceFormat === null) return null;

  return {
    title: row.title,
    sourceFormat: row.sourceFormat,
    sanitizedHtml: row.sanitizedHtml,
    updatedAt: row.updatedAt.toISOString(),
  };
}
