import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

const queryMock = vi.hoisted(() => ({
  getDocumentSummary: vi.fn(),
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("./queries", () => ({
  getDocumentSummary: queryMock.getDocumentSummary,
}));

import type { DocumentShare } from "@/db/schema";
import { hashShareToken } from "./share-tokens";
import {
  createDocumentShare,
  getShareByToken,
  getSharedDocument,
  listDocumentShares,
  recordShareAccess,
  revokeDocumentShare,
} from "./share-store";
import { callsOf, queryResult, renderSql } from "./test-doubles";

const nodeId = "11111111-1111-4111-8111-111111111111";
const shareId = "33333333-3333-4333-8333-333333333333";
const token = "A".repeat(43);
const now = new Date("2026-09-01T12:00:00.000Z");

function shareRow(overrides: Partial<DocumentShare> = {}): DocumentShare {
  return {
    id: shareId,
    nodeId,
    tokenHash: hashShareToken(token),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    revokedAt: null,
    lastAccessedAt: null,
    viewCount: 0,
    createdAt: now,
    ...overrides,
  };
}

function mockSelect(rows: unknown[]) {
  dbMock.select.mockReturnValue(queryResult(rows));
}

function mockInsert(rows: unknown[]) {
  const insert = queryResult(rows);
  dbMock.insert.mockReturnValue(insert);
  return insert;
}

function mockUpdate() {
  const update = queryResult([]);
  dbMock.update.mockReturnValue(update);
  return update;
}

describe("getShareByToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a malformed token without touching the database", async () => {
    const result = await getShareByToken("not-a-token", now);

    expect(result).toBeNull();
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("returns null when no link matches the token hash", async () => {
    mockSelect([]);

    expect(await getShareByToken(token, now)).toBeNull();
  });

  it("looks the link up by hash and never by the raw token", async () => {
    mockSelect([]);

    await getShareByToken(token, now);

    const where = callsOf(dbMock.select.mock.results[0]?.value, "where")[0]?.[0];
    const rendered = renderSql(where);
    expect(rendered.sql).toContain("document_shares");
    expect(rendered.params).toEqual([hashShareToken(token)]);
    expect(rendered.params).not.toContain(token);
  });

  it("returns the owning node for an active link", async () => {
    mockSelect([shareRow()]);

    const result = await getShareByToken(token, now);

    expect(result).toEqual({
      kind: "active",
      nodeId,
      share: expect.objectContaining({ id: shareId, status: "active" }),
    });
  });

  it("reports an expired link without exposing its node", async () => {
    mockSelect([shareRow({ expiresAt: new Date(now.getTime() - 1000) })]);

    const result = await getShareByToken(token, now);

    expect(result?.kind).toBe("expired");
    expect(result).not.toHaveProperty("nodeId");
  });

  it("reports a revoked link", async () => {
    mockSelect([shareRow({ revokedAt: now })]);

    const result = await getShareByToken(token, now);

    expect(result?.kind).toBe("revoked");
    expect(result).not.toHaveProperty("nodeId");
  });
});

describe("listDocumentShares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps rows to summaries in the link's own ordering", async () => {
    mockSelect([
      shareRow({ id: shareId, viewCount: 3 }),
      shareRow({ id: "44444444-4444-4444-8444-444444444444", revokedAt: now }),
    ]);

    const shares = await listDocumentShares(nodeId, now);

    expect(shares).toHaveLength(2);
    expect(shares[0]).toMatchObject({ id: shareId, viewCount: 3, status: "active" });
    expect(shares[1]?.status).toBe("revoked");
  });
});

describe("createDocumentShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.getDocumentSummary.mockResolvedValue({
      id: nodeId,
      title: "Application",
      path: "/app.md",
    });
  });

  it("returns null for an unknown document", async () => {
    queryMock.getDocumentSummary.mockResolvedValue(null);

    const created = await createDocumentShare(nodeId, now);

    expect(created).toBeNull();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("stores only the token hash and returns the raw token once", async () => {
    const insert = mockInsert([
      shareRow({ tokenHash: "ignored-by-this-test" }),
    ]);
    const expiresAt = new Date(now.getTime() + 3600 * 1000);

    const created = await createDocumentShare(nodeId, expiresAt);

    expect(created).not.toBeNull();
    const values = callsOf(insert, "values")[0]?.[0] as {
      nodeId: string;
      tokenHash: string;
      expiresAt: Date;
    };

    expect(values.nodeId).toBe(nodeId);
    expect(values.expiresAt).toBe(expiresAt);
    expect(values.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(values.tokenHash).not.toBe(created?.token);
    // The URL carries the raw token, which is what the caller must copy now.
    expect(created?.url.endsWith(`/s/${created?.token}`)).toBe(true);
  });

  it("fails loudly when the insert returns no row", async () => {
    mockInsert([]);

    await expect(createDocumentShare(nodeId, now)).rejects.toThrow(
      "was not stored",
    );
  });
});

describe("revokeDocumentShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a missing or foreign link", async () => {
    mockSelect([]);

    expect(await revokeDocumentShare(nodeId, shareId)).toBe("missing");
    expect(dbMock.update).not.toHaveBeenCalled();

    const where = callsOf(dbMock.select.mock.results[0]?.value, "where")[0]?.[0];
    const rendered = renderSql(where);
    // Revocation is scoped to the document the caller asked about.
    expect(rendered.params).toEqual([shareId, nodeId]);
  });

  it("is idempotent for an already revoked link", async () => {
    mockSelect([shareRow({ revokedAt: now })]);

    expect(await revokeDocumentShare(nodeId, shareId)).toBe("already-revoked");
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("stamps the revocation time", async () => {
    mockSelect([shareRow()]);
    const update = mockUpdate();

    expect(await revokeDocumentShare(nodeId, shareId)).toBe("revoked");

    const set = callsOf(update, "set")[0]?.[0] as { revokedAt: Date };
    expect(set.revokedAt).toBeInstanceOf(Date);
  });
});

describe("recordShareAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments the view count in a single atomic statement", async () => {
    const update = mockUpdate();

    await recordShareAccess(shareId);

    const set = callsOf(update, "set")[0]?.[0] as {
      viewCount: unknown;
      lastAccessedAt: Date;
    };
    expect(renderSql(set.viewCount).sql).toContain("+ 1");
    expect(set.lastAccessedAt).toBeInstanceOf(Date);

    const where = callsOf(update, "where")[0]?.[0];
    expect(renderSql(where).params).toEqual([shareId]);
  });
});

describe("getSharedDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects only the columns the public page renders", async () => {
    mockSelect([
      {
        title: "Application",
        sourceFormat: "markdown",
        sanitizedHtml: "<p>Hello</p>",
        updatedAt: now,
      },
    ]);

    const document = await getSharedDocument(nodeId);

    // The selection is the public projection, so the private columns
    // (source_content above all) are never even read.
    expect(Object.keys(dbMock.select.mock.calls[0]?.[0] ?? {})).toEqual([
      "title",
      "sourceFormat",
      "sanitizedHtml",
      "updatedAt",
    ]);
    expect(document).toEqual({
      title: "Application",
      sourceFormat: "markdown",
      sanitizedHtml: "<p>Hello</p>",
      updatedAt: "2026-09-01T12:00:00.000Z",
    });
  });

  it("returns null when the document is gone", async () => {
    mockSelect([]);

    expect(await getSharedDocument(nodeId)).toBeNull();
  });

  it("returns null when a folder row slips through", async () => {
    mockSelect([
      {
        title: null,
        sourceFormat: null,
        sanitizedHtml: "<p>Hello</p>",
        updatedAt: now,
      },
    ]);

    expect(await getSharedDocument(nodeId)).toBeNull();
  });
});
