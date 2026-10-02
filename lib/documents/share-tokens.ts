import { createHash, randomBytes } from "node:crypto";

/**
 * Share tokens are bearer credentials that travel in a URL path, so they are
 * generated from 32 random bytes (256 bits) and stored only as a SHA-256 hash.
 *
 * A fast hash is the right choice here, unlike a password KDF: the token has
 * full entropy, so there is no dictionary to slow down, and every public
 * request must resolve one by index. The comparison happens inside the unique
 * index against the hash, which also makes a timing-safe compare unnecessary.
 */
const shareTokenBytes = 32;

// base64url of 32 bytes is always 43 characters, so a malformed token is
// rejected before it reaches the database.
const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken() {
  return randomBytes(shareTokenBytes).toString("base64url");
}

export function looksLikeShareToken(token: string) {
  return shareTokenPattern.test(token);
}

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
