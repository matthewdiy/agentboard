import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDocumentAccess: vi.fn(),
  requestAuthErrorResponse: vi.fn<() => Response | null>(() => null),
  revokeDocumentShare: vi.fn(),
}));

vi.mock("@/lib/request-auth", () => ({
  requireDocumentAccess: mocks.requireDocumentAccess,
  requestAuthErrorResponse: mocks.requestAuthErrorResponse,
}));

vi.mock("@/lib/documents/service", () => ({
  revokeDocumentShare: mocks.revokeDocumentShare,
}));

import { DELETE } from "./route";

const context = {
  params: Promise.resolve({ id: "document-id", shareId: "share-id" }),
};

function del() {
  return DELETE(
    new Request(
      "https://agentboard.example/api/v1/documents/document-id/shares/share-id",
      { method: "DELETE" },
    ),
    context,
  );
}

describe("share revocation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDocumentAccess.mockResolvedValue({ type: "dashboard" });
    mocks.requestAuthErrorResponse.mockReturnValue(null);
  });

  it("revokes with the write scope", async () => {
    mocks.revokeDocumentShare.mockResolvedValue("revoked");

    const response = await del();

    expect(mocks.requireDocumentAccess).toHaveBeenCalledWith(
      expect.anything(),
      "documents:write",
    );
    expect(mocks.revokeDocumentShare).toHaveBeenCalledWith(
      "document-id",
      "share-id",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });
  });

  it("succeeds for an already revoked link so retries are safe", async () => {
    mocks.revokeDocumentShare.mockResolvedValue("already-revoked");

    const response = await del();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });
  });

  it("returns 404 for an unknown link", async () => {
    mocks.revokeDocumentShare.mockResolvedValue("missing");

    const response = await del();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Share link not found.",
    });
  });

  it("passes auth failures through untouched", async () => {
    mocks.requireDocumentAccess.mockRejectedValue(new Error("no session"));
    mocks.requestAuthErrorResponse.mockReturnValue(
      Response.json({ error: "You must be signed in to use this dashboard." }, { status: 401 }),
    );

    const response = await del();

    expect(response.status).toBe(401);
    expect(mocks.revokeDocumentShare).not.toHaveBeenCalled();
  });
});
