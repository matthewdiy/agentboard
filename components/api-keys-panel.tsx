"use client";

import {
  Check,
  Clipboard,
  KeyRound,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ApiKeyRow, type ApiKeySummary } from "@/components/api-key-row";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { authClient } from "@/lib/auth-client";
import { useAsyncAction } from "@/lib/hooks/use-async-action";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";

export function ApiKeysPanel() {
  const [tokens, setTokens] = useState<ApiKeySummary[]>([]);
  const [name, setName] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { copiedKey, copy } = useCopyToClipboard();
  const create = useAsyncAction();
  const remove = useAsyncAction();

  useEffect(() => {
    let cancelled = false;

    async function loadApiKeys() {
      const { data, error: responseError } = await authClient.apiKey.list();
      if (cancelled) return;

      if (responseError) setError(responseError.message || "Unable to list API keys.");
      else setTokens(data?.apiKeys ?? []);
      setLoading(false);
    }

    void loadApiKeys();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createToken() {
    await create.run(async () => {
      const { data, error: responseError } = await authClient.apiKey.create({
        name: name.trim() || "Agent key",
      });
      if (responseError || !data) {
        throw new Error(responseError?.message || "Unable to create API key.");
      }

      const { key, ...summary } = data;
      setTokens((current) => [summary, ...current]);
      setNewToken(key);
      setName("");
    });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    const target = deleteTarget;
    const removed = await remove.run(async () => {
      const { data, error: responseError } = await authClient.apiKey.delete({
        keyId: target.id,
      });
      if (responseError || !data?.success) {
        throw new Error(responseError?.message || "Unable to delete API key.");
      }
      setTokens((current) => current.filter((token) => token.id !== target.id));
    });

    if (removed) setDeleteTarget(null);
  }

  function handleOpenCreate() {
    setName("");
    setNewToken(null);
    create.setError(null);
    setShowCreateDialog(true);
  }


  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      {/* Top Header: Title and Create Key button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-4">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            API Keys
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Manage secret keys for authenticating API requests to the document service.
          </p>
        </div>

        <Button onClick={handleOpenCreate} size="sm" className="h-8 text-xs font-medium self-start sm:self-auto">
          <Plus className="size-3.5" />
          Create new key
        </Button>
      </div>

      {/* API Keys Table Card */}
      <Card className="border-border/80 shadow-xs overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 bg-muted/20 px-5 py-3">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold">Active credentials</CardTitle>
            <CardDescription className="text-xs">
              Keys authorized to access documents via HTTP API.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="font-mono text-[11px] h-5 px-2">
            {tokens.length} {tokens.length === 1 ? "key" : "keys"}
          </Badge>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Spinner className="size-3.5 text-primary" />
              Loading API keys…
            </div>
          ) : tokens.length === 0 ? (
            <div className="p-10 text-center">
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="bg-muted size-10 rounded-lg">
                    <KeyRound className="size-5 text-muted-foreground" />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm font-medium">No API keys</EmptyTitle>
                  <EmptyDescription className="text-xs max-w-sm mx-auto">
                    Generate an API key to allow agents and automated workflows to interact with your library.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              <div className="mt-3">
                <Button size="sm" onClick={handleOpenCreate} className="text-xs h-7.5">
                  <Plus className="size-3.5" />
                  Create API key
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {tokens.map((token) => (
                <ApiKeyRow
                  key={token.id}
                  token={token}
                  onDelete={(target) => {
                    remove.setError(null);
                    setDeleteTarget(target);
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Key Dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setNewToken(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md rounded-xl p-5 border-border/80 shadow-md min-w-0 overflow-hidden">
          {!newToken ? (
            <>
              <DialogHeader className="space-y-1 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md bg-muted text-foreground border border-border/70">
                    <KeyRound className="size-3.5" />
                  </div>
                  <DialogTitle className="text-base font-semibold tracking-tight">Create API key</DialogTitle>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Give your key a descriptive name to identify what is using it.
                </DialogDescription>
              </DialogHeader>

              <form
                className="space-y-4 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createToken();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="create-key-name" className="text-xs font-medium">
                    Key name
                  </Label>
                  <Input
                    id="create-key-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Documentation Bot"
                    className="text-xs h-8"
                    autoFocus
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                    <span className="text-[11px]">Suggestions:</span>
                    {["Documentation Bot", "CI/CD Pipeline", "Worker Service"].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setName(preset)}
                        className="rounded border border-border/80 bg-muted/60 px-1.5 py-0.2 text-[10px] hover:bg-muted hover:text-foreground transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {create.error && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">{create.error}</AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreateDialog(false)}
                    className="text-xs h-7.5"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={create.pending}
                    className="text-xs h-7.5 font-medium"
                  >
                    {create.pending && <Spinner className="size-3 mr-1" />}
                    Create key
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <>
              <DialogHeader className="space-y-1 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-600 border border-emerald-600/20">
                    <ShieldCheck className="size-4" />
                  </div>
                  <DialogTitle className="text-base font-semibold tracking-tight">Key created</DialogTitle>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Copy this key now. For security, it will not be shown again.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-1 min-w-0">
                <div className="flex flex-col gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                      API token
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copy(newToken, "dialog-token")}
                      className="gap-1.5 text-xs shrink-0 h-7 px-2.5 bg-background hover:bg-muted font-medium"
                    >
                      {copiedKey === "dialog-token" ? (
                        <>
                          <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Clipboard className="size-3" />
                          <span>Copy key</span>
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/60 p-2.5 min-w-0 overflow-hidden">
                    <code className="block font-mono text-xs select-all break-all font-medium text-foreground leading-relaxed">
                      {newToken}
                    </code>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setShowCreateDialog(false);
                      setNewToken(null);
                    }}
                    className="text-xs h-7.5 font-medium px-4"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {remove.error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{remove.error}</AlertDescription>
        </Alert>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete API key"
        description={`“${deleteTarget?.name ?? "This key"}” will be deleted permanently. Any connected client using it will lose access immediately.`}
        confirmLabel="Delete key"
        pendingLabel="Deleting…"
        pending={remove.pending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
