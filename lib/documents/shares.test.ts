import { describe, expect, it } from "vitest";

import { ShareInputError } from "./errors";
import {
  maxShareNameLength,
  maxShareTtlSeconds,
  minShareTtlSeconds,
  normalizeShareExpiry,
  normalizeShareName,
  shareStatus,
  toShareSummary,
} from "./shares";
import type { DocumentShare } from "@/db/schema";

const now = new Date("2026-09-01T12:00:00.000Z");

function shareRow(overrides: Partial<DocumentShare> = {}): DocumentShare {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nodeId: "22222222-2222-4222-8222-222222222222",
    name: null,
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

    expect(expiresAt?.toISOString()).toBe("2026-09-01T13:00:00.000Z");
  });

  it("accepts an absolute ISO expiry", () => {
    const expiresAt = normalizeShareExpiry(
      { expiresAt: "2026-09-02T12:00:00.000Z" },
      now,
    );

    expect(expiresAt?.toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });

  it("allows an expiry exactly at the cap", () => {
    const expiresAt = normalizeShareExpiry(
      { expiresInSeconds: maxShareTtlSeconds },
      now,
    );

    expect(expiresAt?.getTime()).toBe(now.getTime() + maxShareTtlSeconds * 1000);
  });

  it("returns no expiry for a never-expiring link", () => {
    expect(normalizeShareExpiry({ neverExpires: true }, now)).toBeNull();
  });

  it("requires exactly one expiry form", () => {
    expect(() => normalizeShareExpiry({}, now)).toThrow(ShareInputError);
    expect(() => normalizeShareExpiry({}, now)).toThrow(
      "A share link expiry or neverExpires flag is required.",
    );

    const message =
      "Provide only one of expiresInSeconds, expiresAt, or neverExpires.";
    expect(() =>
      normalizeShareExpiry(
        { expiresInSeconds: 3600, expiresAt: "2026-09-02T12:00:00.000Z" },
        now,
      ),
    ).toThrow(message);
    expect(() =>
      normalizeShareExpiry({ expiresInSeconds: 3600, neverExpires: true }, now),
    ).toThrow(message);
    expect(() =>
      normalizeShareExpiry(
        { expiresAt: "2026-09-02T12:00:00.000Z", neverExpires: true },
        now,
      ),
    ).toThrow(message);
  });

  it("rejects a neverExpires flag that is not true", () => {
    for (const neverExpires of [false, "true", 1, null]) {
      expect(() => normalizeShareExpiry({ neverExpires }, now)).toThrow(
        "The neverExpires flag must be true when provided.",
      );
    }
  });

  it("never expires from a null expiresAt, which stays an invalid timestamp", () => {
    expect(() => normalizeShareExpiry({ expiresAt: null }, now)).toThrow(
      "The expiry must be an ISO 8601 timestamp.",
    );
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

describe("normalizeShareName", () => {
  it("treats an absent, null, or blank name as unnamed", () => {
    expect(normalizeShareName(undefined)).toBeNull();
    expect(normalizeShareName(null)).toBeNull();
    expect(normalizeShareName("")).toBeNull();
    expect(normalizeShareName("   ")).toBeNull();
  });

  it("trims a supplied name", () => {
    expect(normalizeShareName("  Client preview  ")).toBe("Client preview");
  });

  it("accepts a name at the length limit", () => {
    const name = "a".repeat(maxShareNameLength);

    expect(normalizeShareName(name)).toBe(name);
  });

  it("rejects a name that is too long instead of truncating it", () => {
    expect(() => normalizeShareName("a".repeat(maxShareNameLength + 1))).toThrow(
      `The share link name cannot be longer than ${maxShareNameLength} characters.`,
    );
  });

  it("rejects a non-string name", () => {
    for (const value of [42, true, {}, ["name"]]) {
      expect(() => normalizeShareName(value)).toThrow(ShareInputError);
      expect(() => normalizeShareName(value)).toThrow(
        "The share link name must be a string.",
      );
    }
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

  it("keeps a link with no expiry active", () => {
    expect(shareStatus(shareRow({ expiresAt: null }), now)).toBe("active");
  });

  it("reports revocation ahead of expiry, including without an expiry", () => {
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
    expect(
      shareStatus(shareRow({ revokedAt: now, expiresAt: null }), now),
    ).toBe("revoked");
  });
});

describe("toShareSummary", () => {
  it("serializes timestamps and omits null ones", () => {
    const summary = toShareSummary(shareRow(), now);

    expect(summary).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: null,
      expiresAt: "2026-09-01T13:00:00.000Z",
      createdAt: "2026-09-01T12:00:00.000Z",
      revokedAt: null,
      lastAccessedAt: null,
      viewCount: 0,
      status: "active",
    });
  });

  it("carries the link name", () => {
    const summary = toShareSummary(shareRow({ name: "Client preview" }), now);

    expect(summary.name).toBe("Client preview");
  });

  it("reports a never-expiring link with a null expiry", () => {
    const summary = toShareSummary(shareRow({ expiresAt: null }), now);

    expect(summary.expiresAt).toBeNull();
    expect(summary.status).toBe("active");
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
