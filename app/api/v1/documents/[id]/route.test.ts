import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPathError } from "@/lib/documents/paths";

const mocks = vi.hoisted(() => ({
  requireDocumentAccess: vi.fn(),
  requestAuthErrorResponse: vi.fn(() => null),
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  replaceDocument: vi.fn(),
  DocumentPathConflictError: class DocumentPathConflictError extends Error {},
}));

vi.mock("@/lib/request-auth", () => ({
  requireDocumentAccess: mocks.requireDocumentAccess,
  requestAuthErrorResponse: mocks.requestAuthErrorResponse,
}));

vi.mock("@/lib/documents/service", () => ({
  DocumentPathConflictError: mocks.DocumentPathConflictError,
  getDocument: mocks.getDocument,
  updateDocument: mocks.updateDocument,
  deleteDocument: mocks.deleteDocument,
  replaceDocument: mocks.replaceDocument,
}));

import { DELETE, PATCH } from "./route";

const context = { params: Promise.resolve({ id: "document-id" }) };

function patch(body: unknown) {
  return PATCH(
    new Request("https://agentboard.example/api/v1/documents/document-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context,
  );
}

describe("document item route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDocumentAccess.mockResolvedValue({ type: "api" });
  });

  it("returns 422 for an invalid move path", async () => {
    mocks.updateDocument.mockRejectedValueOnce(
      new DocumentPathError("The document path contains an unsafe segment."),
    );

    const response = await patch({ path: "../app.md" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The document path contains an unsafe segment.",
    });
  });

  it("returns 404 when updating a missing document", async () => {
    mocks.updateDocument.mockResolvedValueOnce(null);

    const response = await patch({ path: "/product/app.md" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Document not found." });
  });

  it("passes a title-only rename through", async () => {
    mocks.updateDocument.mockResolvedValueOnce({ id: "document-id", title: "Renamed" });

    const response = await patch({ title: "Renamed" });

    expect(response.status).toBe(200);
    expect(mocks.updateDocument).toHaveBeenCalledWith("document-id", {
      path: undefined,
      title: "Renamed",
    });
  });

  it("requires a path or a title", async () => {
    const response = await patch({});

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "A document path or title is required.",
    });
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 404 when deleting a missing document", async () => {
    mocks.deleteDocument.mockResolvedValueOnce(false);

    const response = await DELETE(
      new Request("https://agentboard.example/api/v1/documents/document-id", {
        method: "DELETE",
      }),
      context,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Document not found." });
  });
});
