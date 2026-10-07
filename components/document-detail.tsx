"use client";

import { Check, Clock, Copy, HardDrive } from "lucide-react";

import { DocumentActions } from "@/components/document-actions";
import { DocumentArticle } from "@/components/document-article";
import { DocumentShareDialog } from "@/components/document-share-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocumentResponse } from "@/lib/documents/service";
import { formatBytes, formatRelative } from "@/lib/format";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";

export function DocumentDetail({ document }: { document: DocumentResponse }) {
  const { copiedKey, copy } = useCopyToClipboard();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      {/* Top Bar: Metadata on the left, copy action & hamburger menu on the right */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            className="font-mono uppercase text-[10px] px-2 py-0.5 border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
          >
            {document.sourceFormat}
          </Badge>

          <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[11px] border border-border/60">
            <HardDrive className="size-3 text-muted-foreground/70" />
            {formatBytes(document.sourceBytes)}
          </span>

          <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[11px] border border-border/60">
            <Clock className="size-3 text-muted-foreground/70" />
            Updated {formatRelative(document.updatedAt)}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy(document.path, "path")}
            className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5 font-mono px-2"
            title="Copy path"
          >
            {copiedKey === "path" ? (
              <>
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 font-sans text-xs">Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span className="font-sans text-xs">Copy path</span>
              </>
            )}
          </Button>

          <DocumentShareDialog documentId={document.id} />

          <DocumentActions document={document} />
        </div>
      </div>

      {/* Reading Document Article */}
      <DocumentArticle
        html={document.sanitizedHtml}
        className="pt-2 pb-12"
      />
    </div>
  );
}
