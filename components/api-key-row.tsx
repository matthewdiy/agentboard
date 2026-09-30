"use client";

import type { ApiKey } from "@better-auth/api-key";
import { Clock, KeyRound, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "cn";

export type ApiKeySummary = Omit<ApiKey, "key">;

export function ApiKeyRow({
  token,
  onDelete,
}: {
  token: ApiKeySummary;
  onDelete: (token: ApiKeySummary) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border mt-0.5 sm:mt-0",
            token.enabled
              ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
              : "border-border/80 bg-muted text-muted-foreground",
          )}
        >
          <KeyRound className="size-3.5" />
        </div>

        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-foreground">{token.name}</span>
            {token.enabled ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/20 bg-emerald-600/10 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                Active
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-border/80 bg-muted px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                Disabled
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.2 rounded border border-border/80">
              {token.start ?? token.prefix ?? "ab_"}••••••
            </span>
            <span className="flex items-center gap-1 text-[11px]">
              <Clock className="size-3 text-muted-foreground/70" />
              Created {formatDate(token.createdAt)}
            </span>
            {token.lastRequest ? (
              <span className="text-[11px] text-muted-foreground">
                · Last used {formatDate(token.lastRequest)}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/60">· Never used</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end sm:justify-start pt-1 sm:pt-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(token)}
          className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors h-7 px-2"
        >
          <Trash2 className="size-3 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}
