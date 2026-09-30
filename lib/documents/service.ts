/**
 * Public surface for the document feature. Everything outside `lib/documents`
 * imports from this module so the internal split (queries, mutations, tree
 * helpers, cursor encoding) stays free to change.
 */
export {
  DocumentListInputError,
  DocumentPathConflictError,
} from "./errors";
export {
  getDocument,
  getDocumentStats,
  getDocumentSummary,
  getDocumentTree,
  listDocuments,
} from "./queries";
export {
  createDocument,
  deleteDocument,
  replaceDocument,
  updateDocument,
} from "./mutations";
export type { DocumentChanges } from "./mutations";
export type {
  DocumentDirectoryEntry,
  DocumentFileEntry,
  DocumentListOptions,
  DocumentListPage,
  DocumentResponse,
  DocumentStats,
  DocumentSummary,
  DocumentTreeEntry,
  DocumentTreePage,
  DocumentTreeOptions,
} from "./types";
