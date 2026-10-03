import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareInputError } from "@/lib/documents/errors";

const mocks = vi.hoisted(() => ({
  requireDocumentAccess: vi.fn(),
  requestAuthErrorResponse: vi.fn<() => Response | null>(() => null),
  getDocumentSummary: vi.fn(),
  listDocumentShares: vi.fn(),
  createDocumentShare: vi.fn(),
  normalizeShareExpiry: vi.fn(),
  normalizeShareName: vi.fn(),
}));

vi.mock("@/lib/request-auth", () => ({
  requireDocumentAccess: mocks.requireDocumentAccess,
  requestAuthErrorResponse: mocks.requestAuthErrorResponse,
}));

vi.mock("@/lib/documents/service", () => ({
  // The route maps this class to a 422, so the mock must export the real one.
  ShareInputError,
  getDocumentSummary: mocks.getDocumentSummary,
  listDocumentShares: mocks.listDocumentShares,
  createDocumentShare: mocks.createDocumentShare,
  normalizeShareExpiry: mocks.normalizeShareExpiry,
  normalizeShareName: mocks.normalizeShareName,
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ id: "document-id" }) };
const expiresAt = new Date("2026-09-02T12:00:00.000Z");

function post(body: unknown, raw?: string) {
  return POST(
    new Request("https://agentboard.example/api/v1/documents/document-id/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
    context,
  );
}

describe("document shares route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDocumentAccess.mockResolvedValue({ type: "dashboard" });
    mocks.requestAuthErrorResponse.mockReturnValue(null);
    mocks.normalizeShareExpiry.mockReturnValue(expiresAt);
    mocks.normalizeShareName.mockReturnValue(null);
    mocks.getDocumentSummary.mockResolvedValue({ id: "document-id" });
  });

  it("lists links with the read scope", async () => {
    mocks.listDocumentShares.mockResolvedValue([
      { id: "share-1", status: "active" },
    ]);

    const response = await GET(
      new Request("https://agentboard.example/api/v1/documents/document-id/shares"),
      context,
    );

    expect(mocks.requireDocumentAccess).toHaveBeenCalledWith(
      expect.anything(),
      "documents:read",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      shares: [{ id: "share-1", status: "active" }],
    });
  });

  it("returns 404 for an unknown document instead of an empty list", async () => {
    mocks.getDocumentSummary.mockResolvedValue(null);

    const response = await GET(
      new Request("https://agentboard.example/api/v1/documents/document-id/shares"),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.listDocumentShares).not.toHaveBeenCalled();
  });

  it("passes auth failures through untouched", async () => {
    mocks.requireDocumentAccess.mockRejectedValue(new Error("no session"));
    mocks.requestAuthErrorResponse.mockReturnValue(
      Response.json({ error: "You must be signed in to use this dashboard." }, { status: 401 }),
    );

    const response = await GET(
      new Request("https://agentboard.example/api/v1/documents/document-id/shares"),
      context,
    );

    expect(response.status).toBe(401);
  });

  it("creates a link with the write scope and returns the token once", async () => {
    const created = {
      share: { id: "share-1", status: "active" },
      token: "token-value",
      url: "https://agentboard.example/s/token-value",
    };
    mocks.normalizeShareName.mockReturnValue("Client preview");
    mocks.createDocumentShare.mockResolvedValue(created);

    const response = await post({
      name: "Client preview",
      expiresInSeconds: 3600,
    });

    expect(mocks.requireDocumentAccess).toHaveBeenCalledWith(
      expect.anything(),
      "documents:write",
    );
    expect(mocks.normalizeShareName).toHaveBeenCalledWith("Client preview");
    expect(mocks.createDocumentShare).toHaveBeenCalledWith("document-id", {
      name: "Client preview",
      expiresAt,
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(created);
  });

  it("creates a never-expiring link", async () => {
    mocks.normalizeShareExpiry.mockReturnValue(null);
    mocks.createDocumentShare.mockResolvedValue({
      share: { id: "share-1", name: null, expiresAt: null, status: "active" },
      token: "token-value",
      url: "https://agentboard.example/s/token-value",
    });

    const response = await post({ neverExpires: true });

    expect(mocks.normalizeShareExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ neverExpires: true }),
    );
    expect(mocks.createDocumentShare).toHaveBeenCalledWith("document-id", {
      name: null,
      expiresAt: null,
    });
    expect(response.status).toBe(201);
  });

  it("returns 404 when the document is gone", async () => {
    mocks.createDocumentShare.mockResolvedValue(null);

    const response = await post({ expiresInSeconds: 3600 });

    expect(response.status).toBe(404);
  });

  it("returns 422 for invalid expiry input", async () => {
    mocks.normalizeShareExpiry.mockImplementation(() => {
      throw new ShareInputError("A share link expiry or neverExpires flag is required.");
    });

    const response = await post({});

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "A share link expiry or neverExpires flag is required.",
    });
    expect(mocks.createDocumentShare).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid name", async () => {
    mocks.normalizeShareName.mockImplementation(() => {
      throw new ShareInputError("The share link name must be a string.");
    });

    const response = await post({ name: 42, expiresInSeconds: 3600 });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The share link name must be a string.",
    });
    expect(mocks.createDocumentShare).not.toHaveBeenCalled();
  });

  it("returns 422 for a request body that is not an object", async () => {
    // The route's own guard rejects a non-object body before validation.
    const response = await post(undefined, "null");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "A share link expiry or neverExpires flag is required.",
    });
    expect(mocks.normalizeShareExpiry).not.toHaveBeenCalled();
  });

  it("returns 422 for a body that is not JSON", async () => {
    const response = await post(undefined, "{not json");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The request body must be valid JSON.",
    });
  });
});
