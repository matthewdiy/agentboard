import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDocumentAccess: vi.fn(),
  requestAuthErrorResponse: vi.fn(() => null),
  createDocument: vi.fn(),
  listDocuments: vi.fn(),
  DocumentListInputError: class DocumentListInputError extends Error {},
  DocumentPathConflictError: class DocumentPathConflictError extends Error {
    constructor(path: string) {
      super(`A document already exists at ${path}.`);
    }
  },
}));

vi.mock("@/lib/request-auth", () => ({
  requireDocumentAccess: mocks.requireDocumentAccess,
  requestAuthErrorResponse: mocks.requestAuthErrorResponse,
}));

vi.mock("@/lib/documents/service", () => ({
  DocumentListInputError: mocks.DocumentListInputError,
  DocumentPathConflictError: mocks.DocumentPathConflictError,
  createDocument: mocks.createDocument,
  listDocuments: mocks.listDocuments,
}));

import { POST, GET } from "./route";

function uploadRequest() {
  const formData = new FormData();
  formData.append("document", new File(["# Hello"], "hello.md"));
  formData.append("manifest", "[]");
  return new Request("https://agentboard.example/api/v1/documents", {
    method: "POST",
    body: formData,
  });
}

describe("documents collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDocumentAccess.mockResolvedValue({ type: "api" });
  });

  it("returns 409 when a create path is already in use", async () => {
    mocks.createDocument.mockRejectedValueOnce(
      new mocks.DocumentPathConflictError("/product/app.md"),
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A document already exists at /product/app.md.",
    });
  });

  it("accepts an upload that omits the manifest field", async () => {
    mocks.createDocument.mockImplementationOnce(async (upload: { assets: unknown[] }) => ({
      id: "doc-id",
      assets: upload.assets,
    }));

    const formData = new FormData();
    formData.append("document", new File(["# Hello"], "hello.md"));

    const response = await POST(
      new Request("https://agentboard.example/api/v1/documents", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      document: { id: "doc-id", assets: [] },
    });
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ assets: [] }),
    );
  });

  it("returns 422 for invalid list input", async () => {
    mocks.listDocuments.mockRejectedValueOnce(
      new mocks.DocumentListInputError("The cursor is invalid."),
    );

    const response = await GET(
      new Request("https://agentboard.example/api/v1/documents?cursor=bad"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The cursor is invalid.",
    });
  });
});
