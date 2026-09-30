"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { apiRequest } from "@/lib/api-client";
import { getDirectoryAncestors } from "@/lib/documents/paths";
import type { DocumentTreePage } from "@/lib/documents/service";
import {
  applyDirectoryPage,
  type DirectoryState,
  emptyDirectoryState,
  failDirectoryLoad,
  startDirectoryLoad,
} from "@/lib/hooks/directory-state";

export const treeRootPath = "/";

type DocumentTreeValue = {
  /** Children of a folder, or the empty state when it was never fetched. */
  stateFor: (path: string) => DirectoryState;
  isExpanded: (path: string) => boolean;
  expandedCount: number;
  toggle: (path: string) => void;
  /** Expands a folder and every folder above it, loading each on demand. */
  expandDirectory: (path: string) => void;
  collapse: (path: string) => void;
  /** The path of the document on screen, highlighted in the tree. */
  activeDocumentPath: string | null;
  openDocument: (path: string) => void;
  /** Clears the highlight only if `path` is still the active document. */
  clearActiveDocument: (path: string) => void;
  loadMore: (path: string) => void;
  retry: (path: string) => void;
  /** Re-fetches every folder already in the cache after a write. */
  reload: () => void;
};

const DocumentTreeContext = createContext<DocumentTreeValue | null>(null);

export function useDocumentTree() {
  const value = useContext(DocumentTreeContext);
  if (!value) {
    throw new Error("useDocumentTree must be used inside a DocumentTreeProvider.");
  }
  return value;
}

function addAll(current: ReadonlySet<string>, paths: Iterable<string>) {
  const next = new Set(current);
  for (const path of paths) next.add(path);
  return next;
}

/**
 * Owns the folder cache, expansion state and cursor pagination for the
 * sidebar tree. Only the root folder is sent by the server; every other folder
 * is fetched the first time it is opened and then served from the cache, so
 * navigating between documents never refetches the tree.
 */
export function DocumentTreeProvider({
  initialPage,
  children,
}: {
  initialPage: DocumentTreePage;
  children: React.ReactNode;
}) {
  const [cache, setCache] = useState<Record<string, DirectoryState>>(() => ({
    [initialPage.parentPath]: applyDirectoryPage(undefined, initialPage, false),
  }));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);

  // Folders that already have a successful fetch behind them. Reading this in
  // event handlers keeps "open" idempotent without re-requesting a folder.
  const requested = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const cacheRef = useRef(cache);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const loadDirectory = useCallback(async (parentPath: string, cursor?: string) => {
    const requestKey = `${parentPath}::${cursor ?? ""}`;
    if (inFlight.current.has(requestKey)) return;
    inFlight.current.add(requestKey);

    setCache((current) => ({
      ...current,
      [parentPath]: startDirectoryLoad(current[parentPath]),
    }));

    try {
      const params = new URLSearchParams({ parent: parentPath });
      if (cursor) params.set("cursor", cursor);
      const page = await apiRequest<DocumentTreePage>(
        `/api/v1/documents/tree?${params.toString()}`,
        undefined,
        "Unable to load this folder.",
      );
      requested.current.add(parentPath);
      setCache((current) => ({
        ...current,
        [parentPath]: applyDirectoryPage(current[parentPath], page, Boolean(cursor)),
      }));
    } catch (loadError) {
      requested.current.delete(parentPath);
      setCache((current) => ({
        ...current,
        [parentPath]: failDirectoryLoad(
          current[parentPath],
          loadError instanceof Error ? loadError.message : "Unable to load this folder.",
        ),
      }));
    } finally {
      inFlight.current.delete(requestKey);
    }
  }, []);

  const ensureLoaded = useCallback(
    (path: string) => {
      if (requested.current.has(path)) return;
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const expandFolders = useCallback(
    (paths: Iterable<string>) => {
      setExpanded((current) => addAll(current, paths));
      for (const path of paths) ensureLoaded(path);
    },
    [ensureLoaded],
  );

  const toggle = useCallback(
    (path: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      ensureLoaded(path);
    },
    [ensureLoaded],
  );

  const expandDirectory = useCallback(
    (path: string) => {
      if (path === treeRootPath) return;
      expandFolders([...getDirectoryAncestors(path), path]);
    },
    [expandFolders],
  );

  const collapse = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const openDocument = useCallback(
    (path: string) => {
      setActiveDocumentPath(path);
      expandFolders(getDirectoryAncestors(path));
    },
    [expandFolders],
  );

  const clearActiveDocument = useCallback((path: string) => {
    setActiveDocumentPath((current) => (current === path ? null : current));
  }, []);

  const loadMore = useCallback(
    (path: string) => {
      const cursor = cacheRef.current[path]?.nextCursor;
      if (cursor) void loadDirectory(path, cursor);
    },
    [loadDirectory],
  );

  const retry = useCallback(
    (path: string) => {
      requested.current.delete(path);
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const reload = useCallback(() => {
    const paths = Object.keys(cacheRef.current);
    requested.current.clear();
    for (const path of paths) void loadDirectory(path);
  }, [loadDirectory]);

  const value = useMemo<DocumentTreeValue>(
    () => ({
      stateFor: (path) => cache[path] ?? emptyDirectoryState,
      isExpanded: (path) => expanded.has(path),
      expandedCount: expanded.size,
      toggle,
      expandDirectory,
      collapse,
      activeDocumentPath,
      openDocument,
      clearActiveDocument,
      loadMore,
      retry,
      reload,
    }),
    [
      cache,
      expanded,
      toggle,
      expandDirectory,
      collapse,
      activeDocumentPath,
      openDocument,
      clearActiveDocument,
      loadMore,
      retry,
      reload,
    ],
  );

  return (
    <DocumentTreeContext.Provider value={value}>{children}</DocumentTreeContext.Provider>
  );
}
