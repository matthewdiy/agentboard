const maxPathLength = 500;
const supportedDocumentExtensions = new Set([".md", ".markdown", ".html", ".htm"]);

// Mirrors the document_nodes_depth_range check so nesting limits surface as a
// validation error instead of a database constraint violation.
export const maxPathDepth = 64;

export class DocumentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPathError";
  }
}

function decodePath(input: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new DocumentPathError("The document path contains invalid encoding.");
  }

  if (/[\u0000-\u001f\u007f-\u009f]/u.test(decoded)) {
    throw new DocumentPathError("The document path contains a control character.");
  }

  return decoded;
}

function normalizePath(input: string, allowRoot: boolean) {
  if (typeof input !== "string") {
    throw new DocumentPathError("A document path must be a string.");
  }

  let normalized = decodePath(input).trim().replaceAll("\\", "/");
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new DocumentPathError("Windows drive paths are not allowed.");
  }

  normalized = normalized.replace(/^(?:\.\/)+/, "");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/+/g, "/");

  if (normalized.length > maxPathLength) {
    throw new DocumentPathError("The document path is too long.");
  }

  if (normalized !== "/" && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some((segment) => segment === "." || segment === "..") ||
    normalized === ""
  ) {
    throw new DocumentPathError("The document path contains an unsafe segment.");
  }

  if (segments.length > maxPathDepth) {
    throw new DocumentPathError(
      `The document path cannot be nested more than ${maxPathDepth} levels deep.`,
    );
  }

  if (!allowRoot && normalized === "/") {
    throw new DocumentPathError("A document path must include a filename.");
  }

  return normalized;
}

export function normalizeDirectoryPath(input: string) {
  return normalizePath(input, true);
}

export function normalizeDocumentPath(input: string) {
  const normalized = normalizePath(input, false);
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();

  if (!supportedDocumentExtensions.has(extension)) {
    throw new DocumentPathError(
      "Only .md, .markdown, .html, and .htm document paths are supported.",
    );
  }

  return normalized;
}

export function documentPathFromFilename(filename: string) {
  return normalizeDocumentPath(`/${filename}`);
}

export function getDocumentParentPath(documentPath: string) {
  const separator = documentPath.lastIndexOf("/");
  return separator <= 0 ? "/" : documentPath.slice(0, separator);
}

export function getPathName(path: string) {
  return path === "/" ? "root" : path.slice(path.lastIndexOf("/") + 1);
}

export function getDirectoryParentPath(directoryPath: string) {
  const separator = directoryPath.lastIndexOf("/");
  return separator <= 0 ? "/" : directoryPath.slice(0, separator);
}

export function getDirectoryAncestors(documentPath: string) {
  const parentPath = getDocumentParentPath(documentPath);
  if (parentPath === "/") return [];

  const ancestors: string[] = [];
  const segments = parentPath.slice(1).split("/");
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    ancestors.push(current);
  }
  return ancestors;
}

/**
 * Returns a human-readable problem with a document path, or null when it is
 * valid. Lets forms show the same message the API would return, without a
 * round trip. The server stays authoritative.
 */
export function validateDocumentPath(input: string) {
  try {
    normalizeDocumentPath(input);
    return null;
  } catch (error) {
    if (error instanceof DocumentPathError) return error.message;
    throw error;
  }
}
