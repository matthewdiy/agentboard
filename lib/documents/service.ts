/**
 * Public surface for the document feature. Everything outside `lib/documents`
 * imports from this module so the internal split (queries, mutations, tree
 * helpers, cursor encoding) stays free to change.
 */
export {
  DocumentListInputError,
  DocumentPathConflictError,
  ShareInputError,
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
export {
  buildShareUrl,
  createDocumentShare,
  deleteDocumentShare,
  getSharedDocument,
  getShareByToken,
  listDocumentShares,
  recordShareAccess,
  revokeDocumentShare,
} from "./share-store";
export type { ShareLookup } from "./share-store";
export {
  maxShareNameLength,
  normalizeShareExpiry,
  normalizeShareName,
  shareStatus,
} from "./shares";
export type { ShareExpiryInput } from "./shares";
export type {
  DocumentDirectoryEntry,
  DocumentFileEntry,
  DocumentListOptions,
  DocumentListPage,
  DocumentResponse,
  DocumentShareCreated,
  DocumentShareSummary,
  DocumentStats,
  DocumentSummary,
  DocumentTreeEntry,
  DocumentTreePage,
  DocumentTreeOptions,
  SharedDocument,
  ShareStatus,
} from "./types";
