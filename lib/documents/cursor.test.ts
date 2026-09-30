import { describe, expect, it } from "vitest";

import {
  decodeListCursor,
  encodeListCursor,
  likePattern,
  maxQueryLength,
  normalizeTreeCursor,
  pageSize,
  validateQuery,
} from "./cursor";
import { DocumentListInputError } from "./errors";

const documentId = "11111111-1111-4111-8111-111111111111";
const updatedAt = new Date("2026-08-27T04:00:00.000Z");

function cursorFor(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("list cursors", () => {
  it("round-trips the id and timestamp", () => {
    expect(decodeListCursor(encodeListCursor({ id: documentId, updatedAt }))).toEqual({
      id: documentId,
      updatedAt,
    });
  });

  it.each([
    ["garbage", "not-a-cursor"],
    ["a missing id", cursorFor({ updatedAt: updatedAt.toISOString() })],
    ["a non-uuid id", cursorFor({ id: "nope", updatedAt: updatedAt.toISOString() })],
    ["an unparseable date", cursorFor({ id: documentId, updatedAt: "yesterday" })],
  ])("rejects %s", (_label, value) => {
    expect(() => decodeListCursor(value)).toThrow(DocumentListInputError);
  });
});

describe("input guards", () => {
  it("bounds the page size", () => {
    expect(pageSize(undefined)).toBe(50);
    expect(pageSize(10)).toBe(10);
    expect(() => pageSize(0)).toThrow(DocumentListInputError);
    expect(() => pageSize(101)).toThrow(DocumentListInputError);
    expect(() => pageSize(1.5)).toThrow(DocumentListInputError);
  });

  it("trims and bounds the search query", () => {
    expect(validateQuery("  product  ")).toBe("product");
    expect(validateQuery(undefined)).toBe("");
    expect(() => validateQuery("x".repeat(maxQueryLength + 1))).toThrow(
      DocumentListInputError,
    );
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(likePattern("100%_done")).toBe("%100\\%\\_done%");
  });

  it("normalizes tree cursors and rejects unsafe paths", () => {
    expect(normalizeTreeCursor("product//docs/")).toBe("/product/docs");
    expect(() => normalizeTreeCursor("../etc")).toThrow(DocumentListInputError);
  });
});
