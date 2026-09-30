import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-6 shadow-sm text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground border border-border/80">
          <FileQuestion className="size-5" />
        </div>
        <span className="font-mono text-xs font-semibold text-primary">404</span>
        <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground">
          Document not found
        </h1>
        <p className="mt-1.5 text-xs text-muted-foreground">
          The requested document could not be found. It may have been renamed, moved, or deleted.
        </p>
        <Button asChild className="mt-5 w-full text-xs h-8">
          <Link href="/documents" className="gap-1.5">
            <ArrowLeft className="size-3.5" />
            Back to library
          </Link>
        </Button>
      </div>
    </main>
  );
}
