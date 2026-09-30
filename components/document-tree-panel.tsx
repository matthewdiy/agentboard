"use client";

import { FileCode2, FileText, RotateCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DocumentTree } from "@/components/document-tree";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentSearch } from "@/lib/hooks/use-document-search";
import { useDocumentTree } from "@/lib/hooks/use-document-tree";
import { cn } from "cn";

export function DocumentTreePanel() {
  const tree = useDocumentTree();
  const [query, setQuery] = useState("");
  const search = useDocumentSearch(query);

  return (
    <SidebarGroup className="min-h-0 flex-1 gap-2 p-0">
      <SidebarGroupLabel className="justify-between px-3 text-[11px] font-medium text-muted-foreground">
        <span>{search.active ? "Search results" : "Documents"}</span>
        {!search.active && (
          <button
            type="button"
            onClick={tree.reload}
            aria-label="Refresh the document tree"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <RotateCw className="size-3" />
          </button>
        )}
      </SidebarGroupLabel>

      <div className="relative px-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter documents…"
          aria-label="Search documents by title or path"
          className="h-7.5 rounded-md bg-background pr-7 pl-7.5 text-xs shadow-none border-border/80 focus-visible:ring-1 focus-visible:ring-primary/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-4 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <SidebarGroupContent className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {search.active ? (
          <SearchResults
            results={search.results}
            loading={search.loading}
            error={search.error}
            nextCursor={search.nextCursor}
            onLoadMore={search.loadMore}
          />
        ) : (
          <DocumentTree />
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SearchResults({
  results,
  loading,
  error,
  nextCursor,
  onLoadMore,
}: {
  results: ReturnType<typeof useDocumentSearch>["results"];
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  onLoadMore: () => void;
}) {
  if (error) {
    return <p className="px-2 py-2 text-xs text-destructive">{error}</p>;
  }

  if (loading && !results) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-muted-foreground">
        <Spinner className="size-3 text-primary" />
        Searching…
      </div>
    );
  }

  if (results?.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
        No documents match query.
      </p>
    );
  }

  return (
    <>
      <SidebarMenu className="gap-0.5">
        {results?.map((file) => (
          <SidebarMenuItem key={file.id}>
            <SidebarMenuButton
              asChild
              size="sm"
              className="py-1.5 rounded-md text-xs hover:bg-sidebar-accent"
            >
              <Link href={`/documents/${file.id}`} title={file.path}>
                {file.sourceFormat === "markdown" ? (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-xs text-foreground">{file.title}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {file.path}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>

      {nextCursor && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className={cn(
            "mt-1.5 w-full rounded py-1 text-center text-xs text-muted-foreground",
            "hover:text-foreground transition-colors disabled:opacity-50",
          )}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
