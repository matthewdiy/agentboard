import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const double = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };
  return double;
});

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/blob-store", () => ({
  putAsset: vi.fn(async () => undefined),
  deleteAsset: vi.fn(async () => undefined),
}));
vi.mock("./processing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./processing")>()),
  renderDocument: vi.fn(async () => "<h1>Application</h1>"),
}));

import { DocumentPathConflictError } from "./errors";
import { DocumentInputError } from "./processing";
import { createDocument, deleteDocument, replaceDocument, updateDocument } from "./mutations";
import { callsOf, queryResult } from "./test-doubles";

const documentId = "11111111-1111-4111-8111-111111111111";
const date = new Date("2026-08-27T04:00:00.000Z");

function summaryRow(path: string, parentId: string | null = null) {
  return { id: documentId, path, parentId };
}

function fullRow(path: string) {
  return {
    id: documentId,
    kind: "document" as const,
    title: "Application",
    path,
    sourceFormat: "markdown" as const,
    sourceFilename: "app.md",
    contentHash: "hash",
    sourceBytes: 13,
    createdAt: date,
    updatedAt: date,
  };
}

function upload(path?: string) {
  return {
    filename: "app.md",
    path,
    title: "Application",
    format: "markdown" as const,
    source: "# Application",
    sourceBytes: 13,
    assets: [
      {
        path: "images/chart.png",
        mimeType: "image/png",
        sizeBytes: 12,
        bytes: new ArrayBuffer(12),
      },
    ],
  };
}

function uniqueViolation() {
  return Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint: "document_nodes_path_unique",
  });
}

beforeEach(() => {
  for (const fn of [
    dbMock.select,
    dbMock.insert,
    dbMock.update,
    dbMock.delete,
    dbMock.transaction,
  ]) {
    fn.mockReset();
  }
  // The transaction callback receives the same double, so reads and writes
  // inside a transaction are scripted from one place.
  dbMock.transaction.mockImplementation(
    async (run: (tx: typeof dbMock) => Promise<unknown>) => run(dbMock),
  );
});

describe("createDocument", () => {
  it("creates the folder chain, node, contents, and assets in one transaction", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([])) // exact path is free
      .mockReturnValueOnce(queryResult([])) // no ancestor is a document
      .mockReturnValueOnce(
        queryResult([
          {
            node: fullRow("/product/app.md"),
            content: { nodeId: documentId, sourceContent: "# Application", sanitizedHtml: "<h1>Application</h1>" },
          },
        ]),
      )
      .mockReturnValueOnce(queryResult([])); // assets reload

    const folderInsert = queryResult([{ id: "folder-product" }]);
    const nodeInsert = queryResult([]);
    const contentInsert = queryResult([]);
    const assetInsert = queryResult([]);
    dbMock.insert
      .mockReturnValueOnce(folderInsert)
      .mockReturnValueOnce(nodeInsert)
      .mockReturnValueOnce(contentInsert)
      .mockReturnValueOnce(assetInsert);

    const document = await createDocument(upload("/product/app.md"));

    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(callsOf(folderInsert, "values")[0]?.[0]).toMatchObject({
      kind: "folder",
      path: "/product",
    });
    expect(callsOf(nodeInsert, "values")[0]?.[0]).toMatchObject({
      kind: "document",
      path: "/product/app.md",
      parentId: "folder-product",
      title: "Application",
      sourceBytes: 13,
    });
    expect(callsOf(contentInsert, "values")[0]?.[0]).toMatchObject({
      sourceContent: "# Application",
      sanitizedHtml: "<h1>Application</h1>",
    });
    expect(callsOf(assetInsert, "values")[0]?.[0]).toEqual([
      expect.objectContaining({ sourcePath: "images/chart.png", mimeType: "image/png" }),
    ]);
    expect(document?.path).toBe("/product/app.md");
  });

  it("reports a concurrent write as a path conflict", async () => {
    dbMock.select.mockReturnValue(queryResult([]));
    dbMock.insert.mockReturnValue(queryResult([]));
    dbMock.transaction.mockRejectedValueOnce(uniqueViolation());

    await expect(createDocument(upload("/app.md"))).rejects.toThrow(
      DocumentPathConflictError,
    );
  });
});

describe("replaceDocument", () => {
  it("keeps the node id and upserts the content row", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([summaryRow("/app.md")])) // lock
      .mockReturnValueOnce(queryResult([])) // existing assets
      .mockReturnValueOnce(
        queryResult([
          {
            node: fullRow("/app.md"),
            content: { nodeId: documentId, sourceContent: "# Application", sanitizedHtml: "<h1>Application</h1>" },
          },
        ]),
      )
      .mockReturnValueOnce(queryResult([]));

    const contentInsert = queryResult([]);
    const assetInsert = queryResult([]);
    dbMock.insert.mockReturnValueOnce(contentInsert).mockReturnValueOnce(assetInsert);
    const update = queryResult([]);
    dbMock.update.mockReturnValue(update);
    dbMock.delete.mockReturnValue(queryResult([]));

    await replaceDocument(documentId, upload());

    expect(callsOf(contentInsert, "values")[0]?.[0]).toMatchObject({ nodeId: documentId });
    expect(callsOf(contentInsert, "onConflictDoUpdate")[0]?.[0]).toMatchObject({
      target: expect.anything(),
    });
    expect(callsOf(update, "set")[0]?.[0]).toMatchObject({ path: "/app.md" });
  });

  it("returns null for a missing document", async () => {
    dbMock.select.mockReturnValueOnce(queryResult([]));

    await expect(replaceDocument(documentId, upload())).resolves.toBeNull();
  });
});

describe("updateDocument", () => {
  it("re-points the parent and creates the destination folders", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([summaryRow("/app.md")])) // lock
      .mockReturnValueOnce(queryResult([])) // destination path free
      .mockReturnValueOnce(queryResult([])) // ancestor is not a document
      .mockReturnValueOnce(queryResult([fullRow("/b/c.md")])); // summary reload

    const folderInsert = queryResult([{ id: "folder-b" }]);
    dbMock.insert.mockReturnValue(folderInsert);
    const update = queryResult([]);
    dbMock.update.mockReturnValue(update);
    dbMock.delete.mockReturnValue(queryResult([]));

    const moved = await updateDocument(documentId, { path: "/b/c.md" });

    expect(callsOf(folderInsert, "values")[0]?.[0]).toMatchObject({
      kind: "folder",
      path: "/b",
      parentId: null,
    });
    expect(callsOf(update, "set")[0]?.[0]).toMatchObject({
      path: "/b/c.md",
      parentId: "folder-b",
    });
    expect(moved?.path).toBe("/b/c.md");
  });

  it("returns the current summary when the path is unchanged", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([summaryRow("/app.md")]))
      .mockReturnValueOnce(queryResult([fullRow("/app.md")]));

    const moved = await updateDocument(documentId, { path: "/app.md" });

    expect(moved?.path).toBe("/app.md");
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("renames a document without touching the folder tree", async () => {
    dbMock.select
      .mockReturnValueOnce(queryResult([summaryRow("/app.md")])) // lock
      .mockReturnValueOnce(queryResult([fullRow("/app.md")])); // summary reload

    const update = queryResult([]);
    dbMock.update.mockReturnValue(update);

    await updateDocument(documentId, { title: "Renamed" });

    expect(callsOf(update, "set")[0]?.[0]).toMatchObject({
      path: "/app.md",
      title: "Renamed",
    });
    // Only the lock and the summary reload: no path probe, no folder insert.
    expect(dbMock.select).toHaveBeenCalledTimes(2);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("rejects an update with neither a path nor a title", async () => {
    await expect(updateDocument(documentId, {})).rejects.toThrow(DocumentInputError);
    expect(dbMock.transaction).not.toHaveBeenCalled();
  });

  it("maps a unique path violation to a conflict", async () => {
    dbMock.select.mockReturnValue(queryResult([]));
    dbMock.transaction.mockRejectedValueOnce(uniqueViolation());

    await expect(updateDocument(documentId, { path: "/app.md" })).rejects.toThrow(
      DocumentPathConflictError,
    );
  });
});

describe("deleteDocument", () => {
  it("removes the node and prunes the ancestors it emptied", async () => {
    const childProbe = queryResult([]);
    dbMock.select
      .mockReturnValueOnce(queryResult([summaryRow("/product/app.md", "folder-product")]))
      .mockReturnValueOnce(queryResult([])) // assets
      .mockReturnValueOnce(childProbe);

    const nodeDelete = queryResult([{ id: documentId }]);
    const folderDelete = queryResult([{ parentId: null }]);
    dbMock.delete.mockReturnValueOnce(nodeDelete).mockReturnValueOnce(folderDelete);

    await expect(deleteDocument(documentId)).resolves.toBe(true);

    expect(dbMock.delete).toHaveBeenCalledTimes(2);
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
  });

  it("returns false when the document does not exist", async () => {
    dbMock.select.mockReturnValueOnce(queryResult([]));

    await expect(deleteDocument(documentId)).resolves.toBe(false);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });
});
