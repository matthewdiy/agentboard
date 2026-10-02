const pathUniqueConstraint = "document_nodes_path_unique";

export class DocumentListInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentListInputError";
  }
}

export class DocumentPathConflictError extends Error {
  constructor(public readonly path: string) {
    super(`A document already exists at ${path}.`);
    this.name = "DocumentPathConflictError";
  }
}

/** Invalid share-link input, reported to HTTP clients as 422. */
export class ShareInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareInputError";
  }
}

/**
 * The unique path index is the final arbiter of concurrent writes, so a raw
 * Postgres unique violation on that index is reported as a path conflict.
 */
export function isPathUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505" &&
    "constraint" in error &&
    (error as { constraint?: unknown }).constraint === pathUniqueConstraint
  );
}
