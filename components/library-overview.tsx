"use client";

import {
  ArrowUpRight,
  Clock,
  FileCode2,
  FileText,
  FolderTree,
  KeyRound,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { NewDocumentDialog } from "@/components/new-document-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { DocumentStats, DocumentSummary } from "@/lib/documents/service";
import { formatRelative } from "@/lib/format";
import { cn } from "cn";

export function LibraryOverview({
  stats,
  recent,
}: {
  stats: DocumentStats;
  recent: DocumentSummary[];
}) {
  const [filter, setFilter] = useState<"all" | "markdown" | "html">("all");

  const filtered = recent.filter((doc) => {
    if (filter === "markdown") return doc.sourceFormat === "markdown";
    if (filter === "html") return doc.sourceFormat === "html";
    return true;
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      {/* Header section (clean, no AI-gen aurora/sparkles) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-5">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Document Library
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            A private workspace for documents, technical manuals, and structured knowledge.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <NewDocumentDialog
            trigger={
              <Button size="sm" className="font-medium text-xs h-8">
                <Plus className="size-3.5" />
                New document
              </Button>
            }
          />
          <Button variant="outline" size="sm" asChild className="text-xs h-8">
            <Link href="/settings">
              <KeyRound className="size-3.5" />
              API keys
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards: Clean, cohesive, no multi-color rainbows */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total documents"
          value={stats.documentCount}
          icon={<FileText className="size-4 text-primary" />}
          sub="Indexed in library"
        />
        <StatCard
          label="Folders"
          value={stats.folderCount}
          icon={<FolderTree className="size-4 text-primary" />}
          sub="Hierarchical paths"
        />
        <StatCard
          label="Last updated"
          value={stats.latest ? formatRelative(stats.latest.updatedAt) : "—"}
          icon={<Clock className="size-4 text-primary" />}
          hint={stats.latest?.path}
        />
      </div>

      {/* Recent Documents Card */}
      <Card className="border-border/80 shadow-xs">
        <CardHeader className="flex flex-col gap-3 border-b border-border/70 bg-muted/20 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Recent documents</CardTitle>
            <CardDescription className="text-xs">
              Recently uploaded or modified files in this workspace.
            </CardDescription>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border/80 bg-background p-0.5 text-xs">
            <FilterButton
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label="All"
              count={recent.length}
            />
            <FilterButton
              active={filter === "markdown"}
              onClick={() => setFilter("markdown")}
              label="Markdown"
              count={recent.filter((d) => d.sourceFormat === "markdown").length}
            />
            <FilterButton
              active={filter === "html"}
              onClick={() => setFilter("html")}
              label="HTML"
              count={recent.filter((d) => d.sourceFormat === "html").length}
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-10 text-center">
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="bg-muted size-10 rounded-lg">
                    <FileText className="size-5 text-muted-foreground" />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm font-medium">No documents</EmptyTitle>
                  <EmptyDescription className="text-xs max-w-sm mx-auto">
                    {filter === "all"
                      ? "Your library is empty. Upload a Markdown or HTML file to begin."
                      : `No ${filter} documents found.`}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              {filter === "all" && (
                <div className="mt-3">
                  <NewDocumentDialog
                    trigger={
                      <Button size="sm" className="text-xs">
                        <Plus className="size-3.5" />
                        Upload document
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((document) => (
                <li key={document.id}>
                  <Link
                    href={`/documents/${document.id}`}
                    className="group flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex size-7.5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground border border-border/60">
                        {document.sourceFormat === "markdown" ? (
                          <FileText className="size-3.5" />
                        ) : (
                          <FileCode2 className="size-3.5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                            {document.title}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono px-1.5 py-0 h-4 uppercase border-border/80 text-muted-foreground"
                          >
                            {document.sourceFormat}
                          </Badge>
                        </div>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                          {document.path}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {formatRelative(document.updatedAt)}
                      </span>
                      <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  sub?: string;
  hint?: string;
}) {
  return (
    <Card className="border-border/80 shadow-xs">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <CardDescription className="text-xs font-medium text-muted-foreground">
            {label}
          </CardDescription>
          <div className="flex size-7 items-center justify-center rounded-md bg-muted/60 border border-border/60">
            {icon}
          </div>
        </div>
        <CardTitle className="text-xl font-bold tracking-tight mt-1 text-foreground">
          {value}
        </CardTitle>
        {hint ? (
          <p className="truncate font-mono text-[10px] text-muted-foreground mt-0.5">
            {hint}
          </p>
        ) : sub ? (
          <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
        ) : null}
      </CardHeader>
    </Card>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium transition-colors flex items-center gap-1",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full px-1 text-[10px] font-mono",
            active ? "bg-background text-foreground" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
