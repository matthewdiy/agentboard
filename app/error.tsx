"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-6 shadow-sm text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
          <AlertTriangle className="size-5" />
        </div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-1.5 text-xs text-muted-foreground">
          The workspace encountered an unexpected issue while loading.
        </p>
        <Button className="mt-5 w-full gap-1.5 text-xs h-8" onClick={reset}>
          <RefreshCw className="size-3.5" />
          Reload
        </Button>
      </div>
    </main>
  );
}
