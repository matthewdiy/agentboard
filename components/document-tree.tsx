"use client";

import {
  Check,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import type { DocumentFileEntry, DocumentSummary } from "@/lib/documents/service";
import { treeRootPath, useDocumentTree } from "@/lib/hooks/use-document-tree";
import { cn } from "cn";

const indentFor = (depth: number) => ({ paddingLeft: `${8 + depth * 12}px` });

/**
 * A flat, indented rendering of one folder's children. Nesting is expressed
 * with padding rather than nested lists so deep trees stay a single <ul>, and
 * a folder's children only enter the DOM once it has been expanded.
 */
export function DocumentTree({
  parentPath = treeRootPath,
  depth = 0,
}: {
  parentPath?: string;
  depth?: number;
}) {
  const tree = useDocumentTree();
  const state = tree.stateFor(parentPath);

  if (state.error) {
    return (
      <TreeMessage depth={depth}>
        <span className="min-w-0 flex-1 truncate text-destructive text-xs">{state.error}</span>
        <button
          type="button"
          onClick={() => tree.retry(parentPath)}
          className="shrink-0 rounded p-1 hover:bg-sidebar-accent transition-colors"
          aria-label={`Retry loading ${parentPath}`}
        >
          <RotateCw className="size-3 text-muted-foreground" />
        </button>
      </TreeMessage>
    );
  }

  if (!state.loaded) {
    return (
      <TreeMessage depth={depth}>
        <Spinner className="size-3 text-primary" />
        <span className="text-muted-foreground text-xs">Loading…</span>
      </TreeMessage>
    );
  }

  if (state.entries.length === 0) {
    return (
      <TreeMessage depth={depth}>
        <span className="truncate text-muted-foreground/60 text-xs italic">
          {depth === 0 ? "No documents yet" : "Empty"}
        </span>
      </TreeMessage>
    );
  }

  return (
    <>
      <SidebarMenu className="gap-0.5">
        {state.entries.map((entry) =>
          entry.kind === "directory" ? (
            <FolderRow key={entry.path} path={entry.path} name={entry.name} depth={depth} />
          ) : (
            <FileRow key={entry.path} file={entry} depth={depth} />
          ),
        )}
      </SidebarMenu>

      {state.loading && (
        <TreeMessage depth={depth}>
          <Spinner className="size-3 text-primary" />
          <span className="text-muted-foreground text-xs">Loading…</span>
        </TreeMessage>
      )}

      {state.nextCursor && !state.loading && (
        <TreeMessage depth={depth}>
          <button
            type="button"
            onClick={() => tree.loadMore(parentPath)}
            className="truncate text-xs font-medium text-primary hover:underline"
          >
            Load more…
          </button>
        </TreeMessage>
      )}
    </>
  );
}

function FolderRow({ path, name, depth }: { path: string; name: string; depth: number }) {
  const tree = useDocumentTree();
  const expanded = tree.isExpanded(path);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        onClick={() => tree.toggle(path)}
        style={indentFor(depth)}
        aria-expanded={expanded}
        className="gap-1.5 py-1.5 rounded-md hover:bg-sidebar-accent transition-colors text-xs"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150",
            expanded && "rotate-90 text-foreground",
          )}
        />
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground/80" />
        )}
        <span className="truncate text-foreground/90">{name}</span>
      </SidebarMenuButton>

      {expanded && <DocumentTree parentPath={path} depth={depth + 1} />}
    </SidebarMenuItem>
  );
}

function FileRow({ file, depth }: { file: DocumentFileEntry; depth: number }) {
  const tree = useDocumentTree();
  const router = useRouter();
  const active = tree.activeDocumentPath === file.path;
  const link = useRef<HTMLAnchorElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [prevTitle, setPrevTitle] = useState(file.title);
  const [title, setTitle] = useState(file.title);
  const [value, setValue] = useState(file.title);
  const [pending, setPending] = useState(false);
  const settled = useRef(false);

  if (file.title !== prevTitle) {
    setPrevTitle(file.title);
    setTitle(file.title);
    setValue(file.title);
  }

  useEffect(() => {
    if (active) link.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function startEditing() {
    setValue(title);
    settled.current = false;
    setEditing(true);
  }

  function stopEditing() {
    settled.current = true;
    setValue(title);
    setEditing(false);
  }

  async function save() {
    if (pending || settled.current) return;

    const next = value.trim();
    if (!next || next === title) {
      stopEditing();
      return;
    }

    settled.current = true;
    setPending(true);

    try {
      const { document } = await apiRequest<{ document: DocumentSummary }>(
        `/api/v1/documents/${file.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next }),
        },
        "Unable to rename the document.",
      );

      setTitle(document.title);
      setValue(document.title);
      setEditing(false);
      tree.reload();
      router.refresh();
    } catch {
      settled.current = false;
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <SidebarMenuItem>
        <div
          style={indentFor(depth)}
          className="flex items-center gap-1.5 py-1 px-1.5 rounded-md bg-muted text-xs"
        >
          <span className="size-3 shrink-0" aria-hidden />
          {file.sourceFormat === "markdown" ? (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            autoFocus
            value={value}
            disabled={pending}
            aria-label="Rename document"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                stopEditing();
              }
            }}
            onBlur={() => void save()}
            className="min-w-0 flex-1 bg-background px-1.5 py-0.5 rounded text-xs border border-primary outline-none text-foreground font-medium h-6"
          />
          {pending ? (
            <Spinner className="size-3 shrink-0 text-primary" />
          ) : (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                void save();
              }}
              className="p-0.5 hover:text-foreground text-muted-foreground shrink-0 rounded hover:bg-background"
              title="Save name"
              aria-label="Save name"
            >
              <Check className="size-3 text-emerald-600" />
            </button>
          )}
        </div>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="group/file-row relative">
      <SidebarMenuButton
        asChild
        size="sm"
        isActive={active}
        style={indentFor(depth)}
        className={cn(
          "gap-1.5 py-1.5 rounded-md transition-colors text-xs pr-7",
          active
            ? "bg-primary/10 text-primary font-medium"
            : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        <Link
          ref={link}
          href={`/documents/${file.id}`}
          title={file.path}
          onClick={() => tree.openDocument(file.path)}
        >
          <span className="size-3 shrink-0" aria-hidden />
          {file.sourceFormat === "markdown" ? (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
        </Link>
      </SidebarMenuButton>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startEditing();
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/file-row:opacity-100 focus:opacity-100 p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-opacity"
        title="Rename document"
        aria-label="Rename document"
      >
        <Pencil className="size-3" />
      </button>
    </SidebarMenuItem>
  );
}

function TreeMessage({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 py-1 pr-2 text-xs" style={indentFor(depth + 1)}>
      {children}
    </div>
  );
}
