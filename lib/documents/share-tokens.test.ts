import { describe, expect, it } from "vitest";

import {
  generateShareToken,
  hashShareToken,
  looksLikeShareToken,
} from "./share-tokens";

describe("generateShareToken", () => {
  it("returns a 43-character base64url token", () => {
    const token = generateShareToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(looksLikeShareToken(token)).toBe(true);
  });

  it("never repeats a token", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => generateShareToken()),
    );

    expect(tokens.size).toBe(200);
  });
});

describe("looksLikeShareToken", () => {
  it("rejects tokens that are not the expected shape", () => {
    const valid = generateShareToken();

    expect(looksLikeShareToken("")).toBe(false);
    expect(looksLikeShareToken(valid.slice(0, 42))).toBe(false);
    expect(looksLikeShareToken(`${valid}a`)).toBe(false);
    expect(looksLikeShareToken(`${valid.slice(0, 42)}+`)).toBe(false);
    expect(looksLikeShareToken("a".repeat(42) + "!")).toBe(false);
    expect(looksLikeShareToken("../../etc/passwd")).toBe(false);
  });
});

describe("hashShareToken", () => {
  it("hashes deterministically without revealing the token", () => {
    const token = generateShareToken();
    const hash = hashShareToken(token);

    expect(hash).toBe(hashShareToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("hashes different tokens differently", () => {
    expect(hashShareToken(generateShareToken())).not.toBe(
      hashShareToken(generateShareToken()),
    );
  });
});
