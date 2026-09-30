"use client";

import { ArrowRight, FileText, KeyRound, Shield } from "lucide-react";
import { useState } from "react";

import { AppLogo } from "@/components/app-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function LoginCard() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/documents`,
    });
    if (result.error) {
      setError(result.error.message ?? "Unable to start Google sign-in.");
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background px-4 py-12">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-2.5">
            <AppLogo className="size-9" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Agentboard</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            A private document workspace for agents and teams
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Sign in
            </h2>
            <p className="text-xs text-muted-foreground">
              Use your Google account to access documents and manage API keys.
            </p>
          </div>

          <div className="mt-5">
            <Button
              className="w-full h-10 bg-background text-foreground hover:bg-muted border border-border shadow-2xs font-medium text-xs justify-center"
              onClick={signIn}
              disabled={pending}
            >
              {pending ? (
                <Spinner className="size-4 text-primary mr-2" />
              ) : (
                <GoogleIcon className="size-4 shrink-0 mr-2" />
              )}
              <span>{pending ? "Connecting with Google…" : "Continue with Google"}</span>
              {!pending && <ArrowRight className="size-3.5 ml-2 text-muted-foreground" />}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {/* Clean feature list */}
          <div className="mt-6 border-t border-border/70 pt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyRound className="size-3.5 text-primary shrink-0" />
              <span>Scoped, revocable API access tokens</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="size-3.5 text-primary shrink-0" />
              <span>Markdown and HTML document support</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="size-3.5 text-primary shrink-0" />
              <span>Encrypted blob storage with instant search</span>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Access restricted to approved workspace accounts.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.27 21.36 7.37 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.26C.46 8.17 0 10.03 0 12s.46 3.83 1.26 5.42l4.02-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.27 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}
