import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("@/db", () => ({ db: dbMock }));

import { documentNodes } from "@/db/schema";
import { decodeListCursor } from "./cursor";
import {
  getDocument,
  getDocumentStats,
  getDocumentSummary,
  getDocumentTree,
  listDocuments,
} from "./queries";
import { callsOf, queryResult, renderSql } from "./test-doubles";

const documentId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const date = new Date("2026-08-27T04:00:00.000Z");

function documentRow(path: string, overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    kind: "document" as const,
    title: "Application",
    path,
    sourceFormat: "markdown" as const,
    sourceFilename: "app.md",
    contentHash: "hash",
    sourceBytes: 42,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

function folderRow(path: string) {
  return documentRow(path, {
    kind: "folder" as const,
    title: null,
    sourceFormat: null,
    sourceFilename: null,
    contentHash: null,
    sourceBytes: null,
  });
}

function whereSql(query: unknown) {
  return renderSql(callsOf(query, "where")[0]?.[0]);
}

describe("listDocuments", () => {
  beforeEach(() => dbMock.select.mockReset());

  it("selects summary columns, never content", async () => {
    const query = queryResult([documentRow("/product/app.md")]);
    dbMock.select.mockReturnValue(query);

    const page = await listDocuments({ limit: 10 });

    const selection = dbMock.select.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(selection).toMatchObject({
      id: documentNodes.id,
      title: documentNodes.title,
      path: documentNodes.path,
      createdAt: documentNodes.createdAt,
    });
    expect(selection).not.toHaveProperty("sourceContent");
    expect(selection).not.toHaveProperty("sanitizedHtml");
    expect(page.documents[0]).toMatchObject({
      path: "/product/app.md",
      createdAt: date.toISOString(),
    });
    expect(page.nextCursor).toBeNull();
  });

  it("restricts the list to documents so folders never appear", async () => {
    const query = queryResult([]);
    dbMock.select.mockReturnValue(query);

    await listDocuments({});

    const { sql, params } = whereSql(query);
    expect(sql).toContain('"document_nodes"."kind"');
    expect(params).toContain("document");
  });

  it("searches title and path with escaped wildcards", async () => {
    const query = queryResult([]);
    dbMock.select.mockReturnValue(query);

    await listDocuments({ query: "50%_off" });

    const { sql, params } = whereSql(query);
    expect(sql.toLowerCase()).toContain("ilike");
    expect(params).toContain("%50\\%\\_off%");
  });

  it("emits a cursor when more rows exist than the page size", async () => {
    dbMock.select.mockReturnValue(
      queryResult([documentRow("/a.md"), documentRow("/b.md", { id: otherId })]),
    );

    const page = await listDocuments({ limit: 1 });

    expect(page.documents).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeListCursor(page.nextCursor!)).toEqual({
      id: documentId,
      updatedAt: date,
    });
  });

  it("applies a keyset filter for a supplied cursor", async () => {
    const query = queryResult([]);
    dbMock.select.mockReturnValue(query);
    const cursor = Buffer.from(
      JSON.stringify({ id: otherId, updatedAt: date.toISOString() }),
    ).toString("base64url");

    await listDocuments({ cursor });

    const { sql, params } = whereSql(query);
    expect(sql).toContain('"document_nodes"."updated_at"');
    expect(params).toContain(otherId);
  });

  it("rejects an invalid cursor", async () => {
    dbMock.select.mockReturnValue(queryResult([]));

    await expect(listDocuments({ cursor: "nope" })).rejects.toThrow(
      "The cursor is invalid.",
    );
  });
});

describe("getDocumentTree", () => {
  beforeEach(() => dbMock.select.mockReset());

  it("reads root children in one query and maps entry kinds", async () => {
    const query = queryResult([folderRow("/product"), documentRow("/readme.md")]);
    dbMock.select.mockReturnValue(query);

    const page = await getDocumentTree("/", { limit: 10 });

    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect(page.parentPath).toBe("/");
    expect(page.entries[0]).toEqual({
      kind: "directory",
      path: "/product",
      parentPath: "/",
      name: "product",
    });
    expect(page.entries[0]).not.toHaveProperty("documentCount");
    expect(page.entries[1]).toMatchObject({ kind: "file", path: "/readme.md" });
    expect(whereSql(query).sql).toContain("is null");
  });

  it("resolves a folder and reads its children by parent id", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([{ id: "folder-product" }]))
      .mockReturnValueOnce(queryResult([documentRow("/product/app.md")]));

    const page = await getDocumentTree("/product");

    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(page.entries[0]).toMatchObject({ kind: "file", path: "/product/app.md" });
  });

  it("returns an empty page for a folder that does not exist", async () => {
    dbMock.select.mockReturnValueOnce(queryResult([]));

    const page = await getDocumentTree("/missing");

    expect(page).toEqual({ parentPath: "/missing", entries: [], nextCursor: null });
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("paginates children with the last visible path", async () => {
    dbMock.select.mockReturnValue(
      queryResult([documentRow("/a.md"), documentRow("/b.md", { id: otherId })]),
    );

    const page = await getDocumentTree("/", { limit: 1 });

    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).toBe("/a.md");
  });

  it("rejects an invalid parent path", async () => {
    await expect(getDocumentTree("../etc")).rejects.toThrow(
      "The parent path is invalid.",
    );
  });
});

describe("getDocumentStats", () => {
  beforeEach(() => dbMock.select.mockReset());

  it("counts documents and folders separately", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([{ value: 3 }]))
      .mockReturnValueOnce(queryResult([{ value: 2 }]))
      .mockReturnValueOnce(queryResult([documentRow("/a.md")]));

    const stats = await getDocumentStats();

    expect(stats.documentCount).toBe(3);
    expect(stats.folderCount).toBe(2);
    expect(stats.latest?.path).toBe("/a.md");
  });
});

describe("getDocument", () => {
  beforeEach(() => dbMock.select.mockReset());

  it("returns content and public asset URLs", async () => {
    dbMock.select
      .mockReturnValueOnce(
        queryResult([
          {
            node: documentRow("/a.md"),
            content: { nodeId: documentId, sourceContent: "# A", sanitizedHtml: "<h1>A</h1>" },
          },
        ]),
      )
      .mockReturnValueOnce(
        queryResult([
          {
            id: "asset-1",
            nodeId: documentId,
            sourcePath: "images/a.png",
            blobKey: `documents/${documentId}/asset-1`,
            mimeType: "image/png",
            sizeBytes: 10,
            createdAt: date,
          },
        ]),
      );

    const document = await getDocument(documentId);

    expect(document?.sourceContent).toBe("# A");
    expect(document?.sanitizedHtml).toBe("<h1>A</h1>");
    expect(document?.assets[0]?.publicUrl).toMatch(/\/assets\/asset-1$/);
  });

  it("returns null when the document does not exist", async () => {
    dbMock.select.mockReturnValueOnce(queryResult([]));

    await expect(getDocument(documentId)).resolves.toBeNull();
  });

  it("treats a missing content row as an integrity fault", async () => {
    dbMock.select.mockReturnValueOnce(
      queryResult([{ node: documentRow("/a.md"), content: null }]),
    );

    await expect(getDocument(documentId)).rejects.toThrow(/no stored content/);
  });
});

describe("getDocumentSummary", () => {
  beforeEach(() => dbMock.select.mockReset());

  it("returns a summary for a document row", async () => {
    dbMock.select.mockReturnValue(queryResult([documentRow("/a.md")]));

    await expect(getDocumentSummary(documentId)).resolves.toMatchObject({
      id: documentId,
      path: "/a.md",
    });
  });

  it("returns null when nothing matches", async () => {
    dbMock.select.mockReturnValue(queryResult([]));

    await expect(getDocumentSummary(documentId)).resolves.toBeNull();
  });
});
