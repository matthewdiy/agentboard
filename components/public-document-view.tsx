import { useMemo } from "react";
import { cn } from "cn";

import { DocumentArticle } from "@/components/document-article";
import { FloatingToc } from "@/components/floating-toc";
import { TableOfContents } from "@/components/table-of-contents";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SharedDocument } from "@/lib/documents/service";
import { processHtmlHeadings } from "@/lib/documents/toc";
import { formatDate, formatRelative } from "@/lib/format";

/**
 * The public reading view. Visitors see the document, its metadata, and the
 * theme toggle, with progressive enhancement for diagrams and interactive TOC.
 */
export function PublicDocumentView({
  document,
  expiresAt,
}: {
  document: SharedDocument;
  expiresAt: string | null;
}) {
  const { html: processedHtml, headings } = useMemo(
    () => processHtmlHeadings(document.sanitizedHtml),
    [document.sanitizedHtml],
  );

  const hasToc = headings.length > 1;

  return (
    <main
      className={cn(
        "relative mx-auto w-full px-4 py-10 sm:py-14",
        hasToc ? "max-w-6xl 2xl:max-w-7xl" : "max-w-3xl",
      )}
    >
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <header className="mb-8 border-b border-border/70 pb-5 max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Shared document
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {document.title}
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Updated {formatRelative(document.updatedAt)} ·{" "}
          {expiresAt
            ? `Link expires ${formatDate(expiresAt)}`
            : "Link does not expire"}
        </p>
      </header>

      {/* Main Content Area: Article + Optional Right-hand Sticky Table of Contents */}
      <div className="flex items-start gap-8">
        <div className="min-w-0 flex-1 max-w-3xl">
          <DocumentArticle html={processedHtml} className="pb-4" />
        </div>

        {hasToc && (
          <aside className="hidden xl:block w-64 shrink-0 sticky top-12">
            <TableOfContents headings={headings} />
          </aside>
        )}
      </div>

      {/* Floating TOC for mobile and tablet viewports */}
      {hasToc && <FloatingToc headings={headings} />}

      <footer className="mt-12 border-t border-border/70 pt-4 text-xs text-muted-foreground max-w-3xl">
        {expiresAt
          ? "This is a shared copy of a private document. The link stops working once it expires."
          : "This is a shared copy of a private document. The link stays available until the sender revokes it."}
      </footer>
    </main>
  );
}
