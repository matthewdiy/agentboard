import type { SharedDocument } from "@/lib/documents/service";
import { formatDate, formatRelative } from "@/lib/format";

/**
 * The public reading view. It is a server component with no client JavaScript,
 * so a visitor with the link renders the document and nothing else: no
 * dashboard chrome, no navigation, and no internal path or document id.
 */
export function PublicDocumentView({
  document,
  expiresAt,
}: {
  document: SharedDocument;
  expiresAt: string;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8 border-b border-border/70 pb-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Shared document
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {document.title}
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Updated {formatRelative(document.updatedAt)} · Link expires{" "}
          {formatDate(expiresAt)}
        </p>
      </header>

      <article
        className="document-content pb-4"
        dangerouslySetInnerHTML={{ __html: document.sanitizedHtml }}
      />

      <footer className="mt-12 border-t border-border/70 pt-4 text-xs text-muted-foreground">
        This is a shared copy of a private document. The link stops working once
        it expires.
      </footer>
    </main>
  );
}
