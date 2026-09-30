import { DocumentListInputError } from "./errors";
import { DocumentPathError, normalizeDirectoryPath } from "./paths";

export const defaultPageSize = 50;
export const maxPageSize = 100;
export const maxQueryLength = 200;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pageSize(value: number | undefined) {
  if (value === undefined) return defaultPageSize;
  if (!Number.isInteger(value) || value < 1 || value > maxPageSize) {
    throw new DocumentListInputError(
      `The limit must be an integer between 1 and ${maxPageSize}.`,
    );
  }
  return value;
}

export function validateQuery(query: string | undefined) {
  const trimmed = query?.trim() ?? "";
  if (trimmed.length > maxQueryLength) {
    throw new DocumentListInputError("The search query is too long.");
  }
  return trimmed;
}

export function likePattern(query: string) {
  // Search uses a LIKE pattern, so treat user-supplied %/_ characters as
  // literal text instead of allowing them to become additional wildcards.
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export function encodeListCursor(row: { id: string; updatedAt: Date }) {
  // The cursor mirrors the updatedAt/id ordering used by listDocuments. The
  // id tie-breaker keeps pagination deterministic when timestamps collide.
  return Buffer.from(
    JSON.stringify({ id: row.id, updatedAt: row.updatedAt.toISOString() }),
  ).toString("base64url");
}

export function decodeListCursor(value: string) {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { id?: unknown; updatedAt?: unknown };
    if (
      typeof decoded.id !== "string" ||
      typeof decoded.updatedAt !== "string" ||
      !uuidPattern.test(decoded.id)
    ) {
      throw new Error("invalid cursor");
    }

    const updatedAt = new Date(decoded.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new Error("invalid date");
    return { id: decoded.id, updatedAt };
  } catch {
    throw new DocumentListInputError("The cursor is invalid.");
  }
}

export function normalizeTreeCursor(value: string) {
  try {
    return normalizeDirectoryPath(value);
  } catch (error) {
    if (error instanceof DocumentPathError) {
      throw new DocumentListInputError("The tree cursor is invalid.");
    }
    throw error;
  }
}

export function normalizeTreeParent(value: string) {
  try {
    return normalizeDirectoryPath(value);
  } catch (error) {
    if (error instanceof DocumentPathError) {
      throw new DocumentListInputError("The parent path is invalid.");
    }
    throw error;
  }
}
