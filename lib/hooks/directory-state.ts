import type {
  DocumentListPage,
  DocumentSummary,
  DocumentTreeEntry,
  DocumentTreePage,
} from "@/lib/documents/service";

export type DirectoryState = {
  entries: DocumentTreeEntry[];
  nextCursor: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
};

export const emptyDirectoryState: DirectoryState = {
  entries: [],
  nextCursor: null,
  loaded: false,
  loading: false,
  error: null,
};

/**
 * The navigator's cache transitions are pure functions so they can be tested
 * without a DOM, leaving the hook itself as thin wiring.
 */
export function startDirectoryLoad(current?: DirectoryState): DirectoryState {
  return { ...(current ?? emptyDirectoryState), loading: true, error: null };
}

export function failDirectoryLoad(
  current: DirectoryState | undefined,
  message: string,
): DirectoryState {
  return { ...(current ?? emptyDirectoryState), loading: false, error: message };
}

export function applyDirectoryPage(
  current: DirectoryState | undefined,
  page: DocumentTreePage,
  append: boolean,
): DirectoryState {
  const previous = current ?? emptyDirectoryState;
  return {
    entries: append ? [...previous.entries, ...page.entries] : page.entries,
    nextCursor: page.nextCursor,
    loaded: true,
    loading: false,
    error: null,
  };
}

export function applySearchPage(
  current: DocumentSummary[] | null,
  page: DocumentListPage,
  append: boolean,
): DocumentSummary[] {
  const documents = page.documents ?? [];
  return append ? [...(current ?? []), ...documents] : documents;
}
