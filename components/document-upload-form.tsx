"use client";

import {
  FileCode2,
  FileImage,
  FileText,
  FolderTree,
  PenTool,
  UploadCloud,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import { validateDocumentPath } from "@/lib/documents/paths";
import { formatBytes } from "@/lib/format";
import { cn } from "cn";

type DocumentUploadFormProps = {
  documentId?: string;
  initialPath?: string;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
};

type PathFile = File & { webkitRelativePath?: string };

const assetPath = (file: PathFile) => file.webkitRelativePath || file.name;

export function DocumentUploadForm({
  documentId,
  initialPath,
  onSuccess,
  onCancel,
}: DocumentUploadFormProps) {
  const documentInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [assetFiles, setAssetFiles] = useState<PathFile[]>([]);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState(initialPath ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const pathProblem = path.trim() ? validateDocumentPath(path) : null;

  function chooseDocument(file: File | undefined) {
    if (!file) return;
    setDocumentFile(file);
    setError(null);
    if (!title) setTitle(file.name.replace(/\.(?:md|markdown|html?|htm)$/i, ""));
    if (!path) setPath(`/${file.name}`);
  }

  function chooseAssets(files: FileList | null) {
    if (!files) return;
    setAssetFiles(Array.from(files) as PathFile[]);
    setError(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const doc = Array.from(files).find((f) =>
        /\.(?:md|markdown|html?|htm)$/i.test(f.name),
      );
      if (doc) {
        chooseDocument(doc);
      }
      const images = Array.from(files).filter((f) =>
        /\.(?:png|jpe?g|gif|webp|svg)$/i.test(f.name),
      );
      if (images.length > 0) {
        setAssetFiles((prev) => [...prev, ...(images as PathFile[])]);
      }
    }
  }

  function reset() {
    setDocumentFile(null);
    setAssetFiles([]);
    setTitle("");
    setPath(initialPath ?? "");
    if (documentInput.current) documentInput.current.value = "";
    if (assetInput.current) assetInput.current.value = "";
  }

  async function submit() {
    if (!documentFile) {
      setError("Please choose or drop an HTML or Markdown document first.");
      return;
    }

    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.append("document", documentFile);
    formData.append("title", title);
    if (path.trim()) formData.append("path", path.trim());
    const manifest = assetFiles.map((file, index) => ({
      field: `asset_${index}`,
      path: assetPath(file),
    }));
    formData.append("manifest", JSON.stringify(manifest));
    assetFiles.forEach((file, index) => formData.append(`asset_${index}`, file));

    try {
      const payload = await apiRequest<{ document?: { id: string } }>(
        documentId ? `/api/v1/documents/${documentId}` : "/api/v1/documents",
        { method: documentId ? "PUT" : "POST", body: formData },
        "Upload failed.",
      );
      if (!payload.document) throw new Error("Upload failed.");

      reset();
      onSuccess?.(payload.document.id);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  const isMarkdown = documentFile?.name.endsWith(".md") || documentFile?.name.endsWith(".markdown");

  return (
    <form
      className="space-y-3.5 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* Drag & Drop Area / Document Picker */}
      {!documentFile ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => documentInput.current?.click()}
          className={cn(
            "group relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center transition-all cursor-pointer",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border/80 hover:border-primary/60 hover:bg-muted/40 bg-muted/20",
          )}
        >
          <div className="flex size-9 items-center justify-center rounded-md bg-muted text-foreground border border-border/80 mb-2">
            <UploadCloud className="size-4.5 text-primary" />
          </div>
          <p className="text-xs font-semibold text-foreground">
            Drop Markdown or HTML document here
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            or <span className="text-primary font-medium underline underline-offset-2">browse files</span>
          </p>
          <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
            <span className="rounded bg-muted px-1.5 py-0.2 border">.md</span>
            <span className="rounded bg-muted px-1.5 py-0.2 border">.html</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/80 bg-muted/30 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted text-foreground">
              {isMarkdown ? <FileText className="size-4" /> : <FileCode2 className="size-4" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">
                {documentFile.name}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono">
                {formatBytes(documentFile.size)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDocumentFile(null)}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0 h-7"
          >
            <X className="size-3 mr-1" />
            Change
          </Button>
        </div>
      )}

      {/* Image Assets Attachment */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-card p-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-muted text-muted-foreground">
            <FileImage className="size-3" />
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">
              {assetFiles.length > 0
                ? `${assetFiles.length} image asset${assetFiles.length === 1 ? "" : "s"} attached`
                : "Image assets (optional)"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {assetFiles.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAssetFiles([])}
              className="h-6 text-[11px] text-muted-foreground"
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => assetInput.current?.click()}
            className="h-6 text-[11px]"
          >
            {assetFiles.length > 0 ? "Add more" : "Attach images"}
          </Button>
        </div>
      </div>

      <input
        ref={documentInput}
        type="file"
        accept=".md,.markdown,.html,.htm,text/markdown,text/html"
        className="hidden"
        onChange={(event) => chooseDocument(event.target.files?.[0])}
      />
      <input
        ref={assetInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        className="hidden"
        onChange={(event) => chooseAssets(event.target.files)}
      />

      {documentFile && (
        <div className="grid gap-2.5 sm:grid-cols-2 pt-0.5">
          <div className="space-y-1">
            <Label htmlFor="upload-title" className="text-xs font-medium flex items-center gap-1">
              <PenTool className="size-3 text-muted-foreground" />
              Document title
            </Label>
            <Input
              id="upload-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. System Overview"
              className="text-xs h-7.5"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upload-path" className="text-xs font-medium flex items-center gap-1">
              <FolderTree className="size-3 text-muted-foreground" />
              Repository path
            </Label>
            <Input
              id="upload-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/folder/document.md"
              aria-invalid={Boolean(pathProblem)}
              aria-describedby={pathProblem ? "upload-path-error" : undefined}
              spellCheck={false}
              className="font-mono text-xs h-7.5"
            />
          </div>
        </div>
      )}

      {pathProblem && (
        <Alert variant="destructive" id="upload-path-error">
          <AlertDescription className="text-xs">{pathProblem}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel} className="text-xs h-7.5">
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={pending || !documentFile || Boolean(pathProblem)}
          className="font-medium text-xs h-7.5"
        >
          {pending ? <Spinner className="size-3" /> : <UploadCloud className="size-3" />}
          {documentId ? "Replace document" : "Upload document"}
        </Button>
      </div>
    </form>
  );
}
