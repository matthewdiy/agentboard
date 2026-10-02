import { describe, expect, it } from "vitest";

import { ShareInputError } from "./errors";
import {
  maxShareTtlSeconds,
  minShareTtlSeconds,
  normalizeShareExpiry,
  shareStatus,
  toShareSummary,
} from "./shares";
import type { DocumentShare } from "@/db/schema";

const now = new Date("2026-09-01T12:00:00.000Z");

function shareRow(overrides: Partial<DocumentShare> = {}): DocumentShare {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nodeId: "22222222-2222-4222-8222-222222222222",
    tokenHash: "hash",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    revokedAt: null,
    lastAccessedAt: null,
    viewCount: 0,
    createdAt: now,
    ...overrides,
  };
}

describe("normalizeShareExpiry", () => {
  it("converts a relative expiry into an absolute instant", () => {
    const expiresAt = normalizeShareExpiry({ expiresInSeconds: 3600 }, now);

    expect(expiresAt.toISOString()).toBe("2026-09-01T13:00:00.000Z");
  });

  it("accepts an absolute ISO expiry", () => {
    const expiresAt = normalizeShareExpiry(
      { expiresAt: "2026-09-02T12:00:00.000Z" },
      now,
    );

    expect(expiresAt.toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });

  it("allows an expiry exactly at the cap", () => {
    const expiresAt = normalizeShareExpiry(
      { expiresInSeconds: maxShareTtlSeconds },
      now,
    );

    expect(expiresAt.getTime() - now.getTime()).toBe(maxShareTtlSeconds * 1000);
  });

  it("requires exactly one of the two expiry forms", () => {
    expect(() => normalizeShareExpiry({}, now)).toThrow(ShareInputError);
    expect(() => normalizeShareExpiry({}, now)).toThrow(
      "A share link expiry is required.",
    );
    expect(() =>
      normalizeShareExpiry(
        { expiresInSeconds: 3600, expiresAt: "2026-09-02T12:00:00.000Z" },
        now,
      ),
    ).toThrow("Provide either expiresInSeconds or expiresAt, not both.");
  });

  it("rejects seconds outside the allowed range", () => {
    for (const expiresInSeconds of [
      minShareTtlSeconds - 1,
      maxShareTtlSeconds + 1,
      3600.5,
      Number.NaN,
    ]) {
      expect(() => normalizeShareExpiry({ expiresInSeconds }, now)).toThrow(
        ShareInputError,
      );
    }
  });

  it("rejects a non-numeric or non-string expiry", () => {
    expect(() => normalizeShareExpiry({ expiresInSeconds: "3600" }, now)).toThrow(
      "The expiry must be between 60 and 7776000 seconds.",
    );
    expect(() => normalizeShareExpiry({ expiresAt: 1756732800000 }, now)).toThrow(
      "The expiry must be an ISO 8601 timestamp.",
    );
    expect(() => normalizeShareExpiry({ expiresAt: "next tuesday" }, now)).toThrow(
      "The expiry must be an ISO 8601 timestamp.",
    );
  });

  it("rejects an expiry that has already passed", () => {
    expect(() =>
      normalizeShareExpiry({ expiresAt: "2026-08-31T12:00:00.000Z" }, now),
    ).toThrow("The expiry must be in the future.");
    expect(() => normalizeShareExpiry({ expiresAt: now.toISOString() }, now)).toThrow(
      "The expiry must be in the future.",
    );
  });

  it("rejects an expiry beyond the maximum lifetime", () => {
    expect(() =>
      normalizeShareExpiry({ expiresAt: "2026-12-02T12:00:00.000Z" }, now),
    ).toThrow("The expiry cannot be more than 90 days from now.");
  });
});

describe("shareStatus", () => {
  it("reports an unrevoked future link as active", () => {
    expect(shareStatus(shareRow(), now)).toBe("active");
  });

  it("reports a link at or past its expiry as expired", () => {
    expect(shareStatus(shareRow({ expiresAt: now }), now)).toBe("expired");
    expect(
      shareStatus(shareRow({ expiresAt: new Date(now.getTime() - 1) }), now),
    ).toBe("expired");
  });

  it("reports revocation ahead of expiry", () => {
    expect(
      shareStatus(
        shareRow({ revokedAt: new Date(now.getTime() - 1000) }),
        now,
      ),
    ).toBe("revoked");
    expect(
      shareStatus(
        shareRow({
          revokedAt: new Date(now.getTime() - 1000),
          expiresAt: new Date(now.getTime() - 2000),
        }),
        now,
      ),
    ).toBe("revoked");
  });
});

describe("toShareSummary", () => {
  it("serializes timestamps and omits null ones", () => {
    const summary = toShareSummary(shareRow(), now);

    expect(summary).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-09-01T13:00:00.000Z",
      createdAt: "2026-09-01T12:00:00.000Z",
      revokedAt: null,
      lastAccessedAt: null,
      viewCount: 0,
      status: "active",
    });
  });

  it("keeps access and revocation timestamps when present", () => {
    const summary = toShareSummary(
      shareRow({
        revokedAt: new Date("2026-09-01T12:30:00.000Z"),
        lastAccessedAt: new Date("2026-09-01T12:15:00.000Z"),
        viewCount: 7,
      }),
      now,
    );

    expect(summary.revokedAt).toBe("2026-09-01T12:30:00.000Z");
    expect(summary.lastAccessedAt).toBe("2026-09-01T12:15:00.000Z");
    expect(summary.viewCount).toBe(7);
    expect(summary.status).toBe("revoked");
  });
});
