import { describe, expect, it } from "vitest";

import type { DocumentSummary, DocumentTreePage } from "@/lib/documents/service";
import {
  applyDirectoryPage,
  applySearchPage,
  emptyDirectoryState,
  failDirectoryLoad,
  startDirectoryLoad,
} from "./directory-state";

const documentEntry: DocumentSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Application",
  path: "/product/app.md",
  sourceFormat: "markdown",
  sourceFilename: "app.md",
  contentHash: "hash",
  sourceBytes: 13,
  createdAt: "2026-08-27T04:00:00.000Z",
  updatedAt: "2026-08-27T04:00:00.000Z",
};

function page(paths: string[]): DocumentTreePage {
  return {
    parentPath: "/",
    entries: paths.map((path) => ({ kind: "file" as const, ...documentEntry, path })),
    nextCursor: null,
  };
}

describe("directory state", () => {
  it("replaces entries on the first page", () => {
    const next = applyDirectoryPage(undefined, page(["/a.md"]), false);

    expect(next.entries).toHaveLength(1);
    expect(next.loaded).toBe(true);
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  it("appends entries for a cursor page", () => {
    const first = applyDirectoryPage(undefined, page(["/a.md"]), false);
    const second = applyDirectoryPage(first, page(["/b.md"]), true);

    expect(second.entries.map((entry) => entry.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("keeps the cursor from the newest page", () => {
    const next = applyDirectoryPage(
      undefined,
      { ...page(["/a.md"]), nextCursor: "/a.md" },
      false,
    );

    expect(next.nextCursor).toBe("/a.md");
  });

  it("keeps loaded entries visible while reloading", () => {
    const loaded = applyDirectoryPage(undefined, page(["/a.md"]), false);
    const loading = startDirectoryLoad(loaded);

    expect(loading.loading).toBe(true);
    expect(loading.entries).toHaveLength(1);
  });

  it("clears a previous error when a request starts", () => {
    const failed = failDirectoryLoad(emptyDirectoryState, "boom");
    expect(failed.error).toBe("boom");
    expect(startDirectoryLoad(failed).error).toBeNull();
  });

  it("records a failure without discarding entries", () => {
    const loaded = applyDirectoryPage(undefined, page(["/a.md"]), false);
    const failed = failDirectoryLoad(loaded, "offline");

    expect(failed.error).toBe("offline");
    expect(failed.loading).toBe(false);
    expect(failed.entries).toHaveLength(1);
  });
});

describe("search state", () => {
  it("replaces results for a new query", () => {
    const replacement = {
      ...documentEntry,
      id: "22222222-2222-4222-8222-222222222222",
      path: "/b.md",
    };
    const results = applySearchPage(
      [documentEntry],
      { documents: [replacement], nextCursor: null },
      false,
    );

    expect(results.map((entry) => entry.path)).toEqual(["/b.md"]);
  });

  it("appends results when loading more", () => {
    const first = applySearchPage(null, { documents: [documentEntry], nextCursor: null }, false);
    const second = applySearchPage(
      first,
      { documents: [{ ...documentEntry, id: "22222222-2222-4222-8222-222222222222" }], nextCursor: null },
      true,
    );

    expect(second).toHaveLength(2);
  });

  it("starts from an empty list when there is nothing cached", () => {
    const results = applySearchPage(null, { documents: [documentEntry], nextCursor: null }, true);
    expect(results).toHaveLength(1);
  });
});
