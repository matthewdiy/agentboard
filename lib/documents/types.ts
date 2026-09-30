import type { db } from "@/db";

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type DocumentSummary = {
  id: string;
  title: string;
  path: string;
  sourceFormat: "markdown" | "html";
  sourceFilename: string;
  contentHash: string;
  sourceBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentResponse = DocumentSummary & {
  sourceContent: string;
  sanitizedHtml: string;
  assets: Array<{
    id: string;
    sourcePath: string;
    publicUrl: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};

export type DocumentListPage = {
  documents: DocumentSummary[];
  nextCursor: string | null;
};

export type DocumentDirectoryEntry = {
  kind: "directory";
  path: string;
  parentPath: string;
  name: string;
};

export type DocumentFileEntry = DocumentSummary & {
  kind: "file";
};

export type DocumentTreeEntry = DocumentDirectoryEntry | DocumentFileEntry;

export type DocumentTreePage = {
  parentPath: string;
  entries: DocumentTreeEntry[];
  nextCursor: string | null;
};

export type DocumentStats = {
  documentCount: number;
  folderCount: number;
  latest: DocumentSummary | null;
};

export type DocumentListOptions = {
  query?: string;
  limit?: number;
  cursor?: string;
};

export type DocumentTreeOptions = {
  limit?: number;
  cursor?: string;
};
