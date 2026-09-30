"use client";

import { FolderPen, Menu, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DocumentUploadForm } from "@/components/document-upload-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import { validateDocumentPath } from "@/lib/documents/paths";
import type { DocumentResponse } from "@/lib/documents/service";
import { useAsyncAction } from "@/lib/hooks/use-async-action";
import { useDocumentTree } from "@/lib/hooks/use-document-tree";

/** Move, replace, and delete, behind a clean hamburger menu. */
export function DocumentActions({ document }: { document: DocumentResponse }) {
  const router = useRouter();
  const tree = useDocumentTree();
  const [showMove, setShowMove] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [movePath, setMovePath] = useState(document.path);

  const move = useAsyncAction();
  const remove = useAsyncAction();
  const pathProblem = movePath.trim()
    ? validateDocumentPath(movePath)
    : "A document path is required.";

  async function submitMove() {
    const moved = await move.run(async () => {
      await apiRequest(
        `/api/v1/documents/${document.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: movePath }),
        },
        "Unable to move the document.",
      );
    });

    if (!moved) return;
    setShowMove(false);
    tree.reload();
    router.refresh();
  }

  async function confirmDelete() {
    const deleted = await remove.run(async () => {
      await apiRequest(
        `/api/v1/documents/${document.id}`,
        { method: "DELETE" },
        "Unable to delete the document.",
      );
    });

    if (!deleted) return;
    setShowDelete(false);
    tree.reload();
    router.push("/documents");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Document actions"
          >
            <Menu className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48 rounded-lg p-1 shadow-md border-border/80"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem
            className="cursor-pointer gap-2 py-1.5 text-xs"
            onSelect={() => {
              setMovePath(document.path);
              move.setError(null);
              setShowMove(true);
            }}
          >
            <FolderPen className="size-3.5 text-muted-foreground" />
            Move / Rename path
          </DropdownMenuItem>

          <DropdownMenuItem
            className="cursor-pointer gap-2 py-1.5 text-xs"
            onSelect={() => setShowReplace(true)}
          >
            <RefreshCw className="size-3.5 text-muted-foreground" />
            Replace source file
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            className="cursor-pointer gap-2 py-1.5 text-xs"
            onSelect={() => setShowDelete(true)}
          >
            <Trash2 className="size-3.5" />
            Delete document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showMove} onOpenChange={setShowMove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Move document</DialogTitle>
            <DialogDescription className="text-xs">
              Update the document path in the repository tree.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 pt-1"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMove();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="move-path" className="text-xs font-medium">
                Destination Path
              </Label>
              <Input
                id="move-path"
                value={movePath}
                onChange={(event) => setMovePath(event.target.value)}
                placeholder="/folder/filename.md"
                aria-invalid={Boolean(pathProblem)}
                aria-describedby={pathProblem ? "move-path-error" : undefined}
                spellCheck={false}
                className="font-mono text-xs"
              />
              {pathProblem && (
                <Alert variant="destructive" id="move-path-error">
                  <AlertDescription className="text-xs">{pathProblem}</AlertDescription>
                </Alert>
              )}
            </div>

            {move.error && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{move.error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowMove(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={move.pending || Boolean(pathProblem)}>
                {move.pending && <Spinner className="size-3.5" />}
                Save path
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showReplace} onOpenChange={setShowReplace}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Replace document source</DialogTitle>
            <DialogDescription className="text-xs">
              Upload a fresh Markdown or HTML file.
            </DialogDescription>
          </DialogHeader>
          <DocumentUploadForm
            documentId={document.id}
            initialPath={document.path}
            onCancel={() => setShowReplace(false)}
            onSuccess={() => {
              setShowReplace(false);
              tree.reload();
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Delete document"
        description={`“${document.title}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        pending={remove.pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
