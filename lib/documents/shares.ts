import { ShareInputError } from "./errors";
import type { DocumentShare } from "@/db/schema";
import type {
  DocumentShareSummary,
  ShareStatus,
} from "./types";

export const minShareTtlSeconds = 60;
export const maxShareTtlSeconds = 90 * 24 * 60 * 60;

export type ShareExpiryInput = {
  expiresInSeconds?: unknown;
  expiresAt?: unknown;
};

/**
 * Resolves the two accepted expiry forms into a single absolute instant.
 * Exactly one form is allowed so a request can never mean two different things.
 */
export function normalizeShareExpiry(
  input: ShareExpiryInput,
  now = new Date(),
): Date {
  const hasSeconds = input.expiresInSeconds !== undefined;
  const hasInstant = input.expiresAt !== undefined;

  if (hasSeconds && hasInstant) {
    throw new ShareInputError(
      "Provide either expiresInSeconds or expiresAt, not both.",
    );
  }
  if (!hasSeconds && !hasInstant) {
    throw new ShareInputError("A share link expiry is required.");
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
 * A revoked link is never active again, so revocation outranks expiry.
 * Expiry is evaluated at request time; the public page is rendered per request
 * and never cached, so a link cannot outlive its expiry in a shared cache.
 */
export function shareStatus(
  share: Pick<DocumentShare, "expiresAt" | "revokedAt">,
  now = new Date(),
): ShareStatus {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function toShareSummary(
  share: DocumentShare,
  now = new Date(),
): DocumentShareSummary {
  return {
    id: share.id,
    expiresAt: share.expiresAt.toISOString(),
    createdAt: share.createdAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    lastAccessedAt: share.lastAccessedAt?.toISOString() ?? null,
    viewCount: share.viewCount,
    status: shareStatus(share, now),
  };
}
