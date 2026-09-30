import { getAppUrl } from "@/lib/env";
import { documentNodes } from "@/db/schema";
import type { DocumentAsset, DocumentContent, DocumentNode } from "@/db/schema";
import { getPathName } from "./paths";
import type {
  DocumentDirectoryEntry,
  DocumentFileEntry,
  DocumentResponse,
  DocumentSummary,
  DocumentTreeEntry,
} from "./types";

export type DocumentSummaryRow = Pick<
  DocumentNode,
  | "id"
  | "title"
  | "path"
  | "sourceFormat"
  | "sourceFilename"
  | "contentHash"
  | "sourceBytes"
  | "createdAt"
  | "updatedAt"
>;

export const documentSummarySelection = {
  id: documentNodes.id,
  title: documentNodes.title,
  path: documentNodes.path,
  sourceFormat: documentNodes.sourceFormat,
  sourceFilename: documentNodes.sourceFilename,
  contentHash: documentNodes.contentHash,
  sourceBytes: documentNodes.sourceBytes,
  createdAt: documentNodes.createdAt,
  updatedAt: documentNodes.updatedAt,
};

// Payload columns are nullable because folders share this table. The
// kind_payload check guarantees document rows always carry them.
function required<T>(value: T | null, field: string): T {
  if (value === null) throw new Error(`Document row is missing ${field}.`);
  return value;
}

export function toSummary(row: DocumentSummaryRow): DocumentSummary {
  return {
    id: row.id,
    title: required(row.title, "title"),
    path: row.path,
    sourceFormat: required(row.sourceFormat, "sourceFormat"),
    sourceFilename: required(row.sourceFilename, "sourceFilename"),
    contentHash: required(row.contentHash, "contentHash"),
    sourceBytes: required(row.sourceBytes, "sourceBytes"),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDocumentResponse(
  node: DocumentNode,
  content: DocumentContent,
  assets: DocumentAsset[],
): DocumentResponse {
  return {
    ...toSummary(node),
    sourceContent: content.sourceContent,
    sanitizedHtml: content.sanitizedHtml,
    assets: assets.map((asset) => ({
      id: asset.id,
      sourcePath: asset.sourcePath,
      publicUrl: `${getAppUrl()}/assets/${asset.id}`,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    })),
  };
}

/** Maps a tree row to the API's `directory` / `file` entry shape. */
export function toTreeEntry(
  row: DocumentSummaryRow & { kind: "folder" | "document" },
  parentPath: string,
): DocumentTreeEntry {
  if (row.kind === "folder") {
    const directory: DocumentDirectoryEntry = {
      kind: "directory",
      path: row.path,
      parentPath,
      name: getPathName(row.path),
    };
    return directory;
  }

  const file: DocumentFileEntry = { kind: "file", ...toSummary(row) };
  return file;
}
