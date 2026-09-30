import { describe, expect, it } from "vitest";

import {
  documentPathFromFilename,
  DocumentPathError,
  getDirectoryAncestors,
  getDocumentParentPath,
  maxPathDepth,
  normalizeDirectoryPath,
  normalizeDocumentPath,
} from "./paths";

describe("normalizeDocumentPath", () => {
  it("canonicalizes relative paths, separators, and encoding", () => {
    expect(normalizeDocumentPath("./product\\app//overview%20v2.md")).toBe(
      "/product/app/overview v2.md",
    );
    expect(documentPathFromFilename("notes.md")).toBe("/notes.md");
  });

  it.each([
    "../notes.md",
    "/product/../notes.md",
    "/product/%2e%2e/notes.md",
    "..\\notes.md",
    "C:\\notes.md",
    "C:notes.md",
    "/notes.txt",
    "/notes.md\n",
    "/notes%00.md",
    "/",
  ])("rejects unsafe or unsupported path %s", (path) => {
    expect(() => normalizeDocumentPath(path)).toThrow(DocumentPathError);
  });

  it("rejects paths nested deeper than the tree limit", () => {
    const segments = Array.from({ length: maxPathDepth + 1 }, (_, index) => `d${index}`);
    expect(() => normalizeDocumentPath(`/${segments.join("/")}/notes.md`)).toThrow(
      DocumentPathError,
    );
    expect(() =>
      normalizeDirectoryPath(`/${segments.slice(1).join("/")}`),
    ).not.toThrow();
  });
});

describe("directory path helpers", () => {
  it("normalizes directory paths and finds ancestors", () => {
    expect(normalizeDirectoryPath("product//docs/")).toBe("/product/docs");
    expect(getDocumentParentPath("/product/docs/app.md")).toBe("/product/docs");
    expect(getDirectoryAncestors("/product/docs/app.md")).toEqual([
      "/product",
      "/product/docs",
    ]);
    expect(getDirectoryAncestors("/app.md")).toEqual([]);
  });
});
