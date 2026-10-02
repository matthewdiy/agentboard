import { CalendarClock, FileQuestion, Link2Off } from "lucide-react";

import { formatDate } from "@/lib/format";

export type ShareUnavailableReason = "missing" | "expired" | "revoked";

const copy: Record<
  ShareUnavailableReason,
  { icon: typeof FileQuestion; title: string; body: string }
> = {
  missing: {
    icon: FileQuestion,
    title: "This link is not available",
    body: "Check that the address was copied in full. Links are case-sensitive.",
  },
  expired: {
    icon: CalendarClock,
    title: "This link has expired",
    body: "Shared links stop working after their expiry date. Ask the sender for a new one.",
  },
  revoked: {
    icon: Link2Off,
    title: "This link was revoked",
    body: "The sender turned off access to this document. Ask them for a new link.",
  },
};

/**
 * The public dead-end page. Unknown, expired, and revoked links deliberately
 * share one shape, so a visitor learns nothing about a document they cannot see.
 */
export function ShareUnavailable({
  reason,
  expiresAt,
}: {
  reason: ShareUnavailableReason;
  expiresAt?: string;
}) {
  const { icon: Icon, title, body } = copy[reason];

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg border border-border/80 bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-1.5 text-xs text-muted-foreground">{body}</p>
        {reason === "expired" && expiresAt && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Expired {formatDate(expiresAt)}
          </p>
        )}
      </div>
    </main>
  );
}
