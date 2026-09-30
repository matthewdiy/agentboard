"use client";

import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "@/lib/api-client";
import type { DocumentListPage, DocumentSummary } from "@/lib/documents/service";
import { applySearchPage } from "./directory-state";

const searchDebounceMs = 220;
const searchPageSize = 50;

/**
 * Debounced document search with cursor pagination. An empty query clears the
 * results instead of requesting the unfiltered list.
 */
export function useDocumentSearch(query: string) {
  const [results, setResults] = useState<DocumentSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedQuery = query.trim();
  const active = normalizedQuery.length > 0;

  useEffect(() => {
    // With no query there is nothing to synchronize; the inactive values below
    // are derived instead of reset through state.
    if (!active) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        q: normalizedQuery,
        limit: String(searchPageSize),
      });

      void apiRequest<DocumentListPage>(
        `/api/v1/documents?${params.toString()}`,
        { signal: controller.signal },
        "Search failed.",
      )
        .then((page) => {
          setResults((current) => applySearchPage(current, page, false));
          setNextCursor(page.nextCursor ?? null);
        })
        .catch((searchError: unknown) => {
          if (searchError instanceof DOMException && searchError.name === "AbortError") return;
          setResults([]);
          setNextCursor(null);
          setError(searchError instanceof Error ? searchError.message : "Search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, searchDebounceMs);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [active, normalizedQuery]);

  const loadMore = useCallback(async () => {
    if (!normalizedQuery || !nextCursor || loading) return;

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      q: normalizedQuery,
      limit: String(searchPageSize),
      cursor: nextCursor,
    });

    try {
      const page = await apiRequest<DocumentListPage>(
        `/api/v1/documents?${params.toString()}`,
        undefined,
        "Unable to load more results.",
      );
      setResults((current) => applySearchPage(current, page, true));
      setNextCursor(page.nextCursor ?? null);
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Unable to load more results.",
      );
    } finally {
      setLoading(false);
    }
  }, [loading, nextCursor, normalizedQuery]);

  return {
    results: active ? results : null,
    nextCursor: active ? nextCursor : null,
    loading: active && loading,
    error: active ? error : null,
    loadMore,
    active,
  };
}
