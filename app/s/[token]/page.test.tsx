import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getShareByToken: vi.fn(),
  getSharedDocument: vi.fn(),
  recordShareAccess: vi.fn(),
}));

class NotFoundSignal extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
}));

vi.mock("@/lib/documents/service", () => ({
  getShareByToken: mocks.getShareByToken,
  getSharedDocument: mocks.getSharedDocument,
  recordShareAccess: mocks.recordShareAccess,
}));

import SharedDocumentPage, { generateMetadata } from "./page";

const sanitizedHtml = "<p>Secret body</p>";
const document = {
  title: "Quarterly plan",
  sourceFormat: "markdown" as const,
  sanitizedHtml,
  updatedAt: "2026-09-01T12:00:00.000Z",
};

function share(
  status: "active" | "expired" | "revoked",
  overrides: { name?: string | null; expiresAt?: string | null } = {},
) {
  return {
    id: "share-1",
    name: null,
    expiresAt: "2026-09-02T12:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    revokedAt: status === "revoked" ? "2026-09-01T13:00:00.000Z" : null,
    lastAccessedAt: null,
    viewCount: 0,
    status,
    ...overrides,
  };
}

function page(token: string) {
  return SharedDocumentPage({ params: Promise.resolve({ token }) });
}

function render(token: string) {
  return page(token).then(renderToStaticMarkup);
}

function metadata(token: string) {
  return generateMetadata({ params: Promise.resolve({ token }) });
}

describe("shared document page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSharedDocument.mockResolvedValue(document);
  });

  it("renders the document for an active link and counts one view", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "active",
      nodeId: "node-1",
      share: share("active"),
    });

    const html = await render("active-token");

    expect(html).toContain("Quarterly plan");
    expect(html).toContain(sanitizedHtml);
    expect(mocks.recordShareAccess).toHaveBeenCalledTimes(1);
    expect(mocks.recordShareAccess).toHaveBeenCalledWith("share-1");
  });

  it("renders a never-expiring link and tells the viewer it has no deadline", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "active",
      nodeId: "node-1",
      share: share("active", { expiresAt: null }),
    });

    const html = await render("never-expiring-token");

    expect(html).toContain(sanitizedHtml);
    expect(html).toContain("Link does not expire");
    expect(mocks.recordShareAccess).toHaveBeenCalledWith("share-1");
  });

  it("never shows the owner-facing link name to a viewer", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "active",
      nodeId: "node-1",
      share: share("active", { name: "Client preview — confidential" }),
    });

    const html = await render("named-token");

    expect(html).toContain(sanitizedHtml);
    expect(html).not.toContain("Client preview");
    expect(html).not.toContain("confidential");
  });

  it("never renders the document for an expired link", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "expired",
      share: share("expired"),
    });

    const html = await render("expired-token");

    expect(html).not.toContain(sanitizedHtml);
    expect(html).not.toContain("Quarterly plan");
    expect(html).toContain("This link has expired");
    expect(mocks.getSharedDocument).not.toHaveBeenCalled();
    expect(mocks.recordShareAccess).not.toHaveBeenCalled();
  });

  it("never renders the document for a revoked link", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "revoked",
      share: share("revoked"),
    });

    const html = await render("revoked-token");

    expect(html).not.toContain(sanitizedHtml);
    expect(html).toContain("This link was revoked");
    expect(mocks.recordShareAccess).not.toHaveBeenCalled();
  });

  it("reports an unknown token as not found without touching the document", async () => {
    mocks.getShareByToken.mockResolvedValue(null);

    await expect(render("unknown-token")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(mocks.getSharedDocument).not.toHaveBeenCalled();
  });

  it("reports not found when the document disappears", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "active",
      nodeId: "node-1",
      share: share("active"),
    });
    mocks.getSharedDocument.mockResolvedValue(null);

    await expect(render("orphaned-token")).rejects.toBeInstanceOf(
      NotFoundSignal,
    );
    expect(mocks.recordShareAccess).not.toHaveBeenCalled();
  });

  it("keeps a live link out of search indexes", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "active",
      nodeId: "node-1",
      share: share("active"),
    });

    const meta = await metadata("metadata-active-token");

    expect(meta.title).toBe("Quarterly plan");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("does not put the document title in metadata for a dead link", async () => {
    mocks.getShareByToken.mockResolvedValue({
      kind: "expired",
      share: share("expired"),
    });

    const meta = await metadata("metadata-expired-token");

    expect(meta.title).toBe("Link unavailable");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(mocks.getSharedDocument).not.toHaveBeenCalled();
  });
});
