import { ShareInputError } from "./errors";
import type { DocumentShare } from "@/db/schema";
import type {
  DocumentShareSummary,
  ShareStatus,
} from "./types";

export const minShareTtlSeconds = 60;
export const maxShareTtlSeconds = 90 * 24 * 60 * 60;
export const maxShareNameLength = 80;

export type ShareExpiryInput = {
  expiresInSeconds?: unknown;
  expiresAt?: unknown;
  neverExpires?: unknown;
};

/**
 * Resolves the three accepted expiry forms into a single absolute instant, or
 * `null` for a link that never expires. Exactly one form is allowed so a
 * request can never mean two different things.
 *
 * Never-expiring is expressed only by an explicit `neverExpires: true`, never
 * by a null `expiresAt`, so a missing key and an explicit null cannot be
 * confused with each other.
 */
export function normalizeShareExpiry(
  input: ShareExpiryInput,
  now = new Date(),
): Date | null {
  const hasSeconds = input.expiresInSeconds !== undefined;
  const hasInstant = input.expiresAt !== undefined;
  const hasNever = input.neverExpires !== undefined;
  const forms = [hasSeconds, hasInstant, hasNever].filter(Boolean).length;

  if (forms === 0) {
    throw new ShareInputError(
      "A share link expiry or neverExpires flag is required.",
    );
  }
  if (forms > 1) {
    throw new ShareInputError(
      "Provide only one of expiresInSeconds, expiresAt, or neverExpires.",
    );
  }

  if (hasNever) {
    if (input.neverExpires !== true) {
      throw new ShareInputError(
        "The neverExpires flag must be true when provided.",
      );
    }
    return null;
  }

  const expiresAt = hasSeconds
    ? new Date(now.getTime() + readTtlSeconds(input.expiresInSeconds) * 1000)
    : readInstant(input.expiresAt);

  if (expiresAt.getTime() <= now.getTime()) {
    throw new ShareInputError("The expiry must be in the future.");
  }
  if (expiresAt.getTime() - now.getTime() > maxShareTtlSeconds * 1000) {
    throw new ShareInputError(
      `The expiry cannot be more than ${maxShareTtlSeconds / (24 * 60 * 60)} days from now.`,
    );
  }

  return expiresAt;
}

function readTtlSeconds(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minShareTtlSeconds ||
    value > maxShareTtlSeconds
  ) {
    throw new ShareInputError(
      `The expiry must be between ${minShareTtlSeconds} and ${maxShareTtlSeconds} seconds.`,
    );
  }
  return value;
}

function readInstant(value: unknown) {
  if (typeof value !== "string") {
    throw new ShareInputError("The expiry must be an ISO 8601 timestamp.");
  }

  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ShareInputError("The expiry must be an ISO 8601 timestamp.");
  }
  return expiresAt;
}

/**
 * A link name is an owner-facing label, so a blank one is simply absent rather
 * than an error. Over-length input is rejected instead of silently truncated,
 * so an API caller never gets back a name it did not send.
 */
export function normalizeShareName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ShareInputError("The share link name must be a string.");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxShareNameLength) {
    throw new ShareInputError(
      `The share link name cannot be longer than ${maxShareNameLength} characters.`,
    );
  }

  return trimmed;
}

/**
 * A revoked link is never active again, so revocation outranks expiry.
 * A null expiry has no deadline: only revocation ends such a link.
 *
 * Expiry is evaluated at request time; the public page is rendered per request
 * and never cached, so a link cannot outlive its expiry in a shared cache.
 */
export function shareStatus(
  share: Pick<DocumentShare, "expiresAt" | "revokedAt">,
  now = new Date(),
): ShareStatus {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "active";
}

export function toShareSummary(
  share: DocumentShare,
  now = new Date(),
): DocumentShareSummary {
  return {
    id: share.id,
    name: share.name,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null,
    viewCount: share.viewCount,
    status: shareStatus(share, now),
  };
}
