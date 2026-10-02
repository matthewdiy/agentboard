"use client";

import {
  Check,
  Clipboard,
  Clock,
  Eye,
  Link2,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import type {
  DocumentShareCreated,
  DocumentShareSummary,
  ShareStatus,
} from "@/lib/documents/service";
import { formatDate, formatRelative } from "@/lib/format";
import { useAsyncAction } from "@/lib/hooks/use-async-action";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";
import { cn } from "cn";

const presets = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];

const maxTtlDays = 90;

const statusStyles: Record<ShareStatus, string> = {
  active:
    "border-emerald-600/20 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  expired: "border-border/80 bg-muted text-muted-foreground",
  revoked: "border-border/80 bg-muted text-muted-foreground",
};

function statusLabel(status: ShareStatus) {
  if (status === "active") return "Active";
  return status === "expired" ? "Expired" : "Revoked";
}

/** Local datetime string for a `datetime-local` input, offset by days. */
function localDateTimeValue(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Creates and manages public links for one document. Each link is a bearer
 * credential, so the URL is shown once on creation and never read back.
 */
export function DocumentShareDialog({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<DocumentShareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState(String(presets[0]?.seconds ?? 3600));
  const [customExpiry, setCustomExpiry] = useState(() => localDateTimeValue(7));
  const [created, setCreated] = useState<DocumentShareCreated | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DocumentShareSummary | null>(
    null,
  );
  const { copiedKey, copy } = useCopyToClipboard();
  const create = useAsyncAction();
  const revoke = useAsyncAction();

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest<{ shares: DocumentShareSummary[] }>(
        `/api/v1/documents/${documentId}/shares`,
        undefined,
        "Unable to load share links.",
      );
      setShares(payload.shares);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load share links.",
      );
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  async function submitCreate() {
    await create.run(async () => {
      const body =
        preset === "custom"
          ? { expiresAt: new Date(customExpiry).toISOString() }
          : { expiresInSeconds: Number(preset) };

      const payload = await apiRequest<DocumentShareCreated>(
        `/api/v1/documents/${documentId}/shares`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        "Unable to create a share link.",
      );

      setCreated(payload);
      await loadShares();
    });
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;

    const revoked = await revoke.run(async () => {
      await apiRequest(
        `/api/v1/documents/${documentId}/shares/${target.id}`,
        { method: "DELETE" },
        "Unable to revoke the share link.",
      );
      setShares((current) =>
        current.map((share) =>
          share.id === target.id
            ? { ...share, status: "revoked", revokedAt: new Date().toISOString() }
            : share,
        ),
      );
    });

    if (revoked) setRevokeTarget(null);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            // The list is refreshed every time the dialog opens, so expiries
            // and revocations made in another tab are never stale.
            void loadShares();
          } else {
            setCreated(null);
            create.setError(null);
            revoke.setError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Share as a public link"
          >
            <Share2 className="size-3.5" />
            <span className="font-sans text-xs">Share</span>
          </Button>
        </DialogTrigger>

        <DialogContent className="rounded-xl border-border/80 p-5 shadow-md sm:max-w-lg">
          <DialogHeader className="space-y-1 pb-1">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-md border border-border/70 bg-muted text-foreground">
                <Link2 className="size-3.5" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight">
                Public share links
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Anyone with the link can read this document until it expires.
              Images stay publicly readable at their own URLs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {created ? (
              <div className="space-y-2 rounded-md border border-emerald-600/30 bg-emerald-600/5 p-2.5">
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  Link created — copy it now, it is not shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border border-border/80 bg-background px-2 py-1 font-mono text-[11px] select-all">
                    {created.url}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(created.url, "share-url")}
                    className="h-7 shrink-0 gap-1 text-xs"
                  >
                    {copiedKey === "share-url" ? (
                      <>
                        <Check className="size-3 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Clipboard className="size-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Expires {formatDate(created.share.expiresAt)}
                </p>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitCreate();
                }}
              >
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Link expires in</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setPreset(String(option.seconds))}
                        className={cn(
                          "rounded border px-2 py-1 text-[11px] transition-colors",
                          preset === String(option.seconds)
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border/80 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPreset("custom")}
                      className={cn(
                        "rounded border px-2 py-1 text-[11px] transition-colors",
                        preset === "custom"
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border/80 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      Custom
                    </button>
                  </div>
                  {preset === "custom" && (
                    <Input
                      type="datetime-local"
                      value={customExpiry}
                      min={localDateTimeValue(0)}
                      max={localDateTimeValue(maxTtlDays)}
                      onChange={(event) => setCustomExpiry(event.target.value)}
                      className="mt-1.5 h-8 text-xs"
                    />
                  )}
                </div>

                {create.error && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">
                      {create.error}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  type="submit"
                  size="sm"
                  disabled={create.pending}
                  className="h-7.5 text-xs font-medium"
                >
                  {create.pending ? (
                    <Spinner className="mr-1 size-3" />
                  ) : (
                    <Plus className="mr-1 size-3.5" />
                  )}
                  Create link
                </Button>
              </form>
            )}

            <div className="rounded-md border border-border/70">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-2">
                <span className="text-xs font-semibold">Existing links</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {shares.length}
                </span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Spinner className="size-3.5 text-primary" />
                  Loading links…
                </div>
              ) : shares.length === 0 ? (
                <div className="p-6">
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia
                        variant="icon"
                        className="size-9 rounded-lg bg-muted"
                      >
                        <Link2 className="size-4 text-muted-foreground" />
                      </EmptyMedia>
                      <EmptyTitle className="text-xs font-medium">
                        No public links
                      </EmptyTitle>
                      <EmptyDescription className="text-[11px]">
                        This document is private until you create a link.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {shares.map((share) => (
                    <div
                      key={share.id}
                      className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-1.5 py-0.2 text-[10px] font-medium",
                              statusStyles[share.status],
                            )}
                          >
                            {statusLabel(share.status)}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="size-3 text-muted-foreground/70" />
                            Created {formatRelative(share.createdAt)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                          <span>
                            {share.status === "expired" ? "Expired" : "Expires"}{" "}
                            {formatDate(share.expiresAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="size-3 text-muted-foreground/70" />
                            {share.viewCount}{" "}
                            {share.viewCount === 1 ? "view" : "views"}
                          </span>
                        </div>
                      </div>

                      {share.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            revoke.setError(null);
                            setRevokeTarget(share);
                          }}
                          className="h-7 shrink-0 px-2 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="mr-1 size-3" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {loadError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  {loadError}
                </AlertDescription>
              </Alert>
            )}

            {revoke.error && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  {revoke.error}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
        title="Revoke share link"
        description="The link stops working immediately for everyone who has it. This cannot be undone."
        confirmLabel="Revoke link"
        pendingLabel="Revoking…"
        pending={revoke.pending}
        onConfirm={() => void confirmRevoke()}
      />
    </>
  );
}
