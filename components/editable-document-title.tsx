"use client";

import { CornerDownLeft, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import type { DocumentSummary } from "@/lib/documents/service";
import { useDocumentTree } from "@/lib/hooks/use-document-tree";

const headingClass = "text-xl font-semibold tracking-tight break-words sm:text-2xl text-foreground";

/**
 * Click-to-edit heading. The server response — not the typed value — becomes
 * the displayed title, so normalisation or truncation on the way in is always
 * reflected. `settled` stops Enter from saving twice once blur follows it.
 *
 * The parent keys this component on the document title so a title changed
 * elsewhere still resets the local copy.
 */
export function EditableDocumentTitle({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const tree = useDocumentTree();
  const [current, setCurrent] = useState(title);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);

  function startEditing() {
    setValue(current);
    setError(null);
    settled.current = false;
    setEditing(true);
  }

  function stopEditing() {
    settled.current = true;
    setValue(current);
    setError(null);
    setEditing(false);
  }

  async function save() {
    if (pending || settled.current) return;

    const next = value.trim();
    if (!next || next === current) {
      stopEditing();
      return;
    }

    settled.current = true;
    setPending(true);
    setError(null);

    try {
      const { document } = await apiRequest<{ document: DocumentSummary }>(
        `/api/v1/documents/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next }),
        },
        "Unable to rename the document.",
      );

      setCurrent(document.title);
      setValue(document.title);
      setEditing(false);
      // The sidebar renders the same title, so refresh both surfaces.
      tree.reload();
      router.refresh();
    } catch (saveError) {
      // Keep the editor open so the typed value can be retried.
      settled.current = false;
      setError(
        saveError instanceof Error ? saveError.message : "Unable to rename the document.",
      );
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="relative">
          <input
            autoFocus
            value={value}
            disabled={pending}
            aria-label="Document title"
            aria-invalid={Boolean(error)}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                stopEditing();
              }
            }}
            className={`w-full rounded-lg border-2 border-indigo-500 bg-background/90 px-3 py-1.5 shadow-sm outline-none transition-all disabled:opacity-60 ${headingClass}`}
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {pending ? (
            <p className="flex items-center gap-1.5 text-indigo-500">
              <Spinner className="size-3.5" />
              Saving changes…
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border">
                <CornerDownLeft className="size-2.5" /> Enter to save
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border">
                Esc to cancel
              </span>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <h1 className={headingClass}>
      <button
        type="button"
        onClick={startEditing}
        title="Click to rename document"
        className="group/title flex max-w-full items-start gap-2.5 rounded-lg p-1 -m-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-indigo-500/50"
      >
        <span className="break-words">{current}</span>
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground opacity-0 transition-all group-hover/title:opacity-100">
          <Pencil className="size-3" />
          <span>Rename</span>
        </span>
        <span className="sr-only">Rename document</span>
      </button>
    </h1>
  );
}
