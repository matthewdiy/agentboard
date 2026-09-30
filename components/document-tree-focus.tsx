"use client";

import { useEffect } from "react";

import { useDocumentTree } from "@/lib/hooks/use-document-tree";

/**
 * Mirrors the document on screen into the sidebar. Expanding and lazily loading
 * the folders above it is what makes deep links, refreshes and search-result
 * clicks land with the tree already opened at the right place.
 */
export function DocumentTreeFocus({ path }: { path: string }) {
  const { openDocument, clearActiveDocument } = useDocumentTree();

  useEffect(() => {
    openDocument(path);
    return () => clearActiveDocument(path);
  }, [path, openDocument, clearActiveDocument]);

  return null;
}
