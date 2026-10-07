import { DocumentArticle } from "@/components/document-article";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SharedDocument } from "@/lib/documents/service";
import { formatDate, formatRelative } from "@/lib/format";

/**
 * The public reading view. Visitors see the document, its metadata, and the
 * theme toggle, with progressive enhancement for diagrams.
 */
export function PublicDocumentView({
  document,
  expiresAt,
}: {
  document: SharedDocument;
  expiresAt: string | null;
}) {
  return (
    <main className="relative mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <header className="mb-8 border-b border-border/70 pb-5">
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

      <DocumentArticle html={document.sanitizedHtml} className="pb-4" />

      <footer className="mt-12 border-t border-border/70 pt-4 text-xs text-muted-foreground">
        {expiresAt
          ? "This is a shared copy of a private document. The link stops working once it expires."
          : "This is a shared copy of a private document. The link stays available until the sender revokes it."}
      </footer>
    </main>
  );
}
