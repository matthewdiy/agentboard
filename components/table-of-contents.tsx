"use client";

import { useMemo } from "react";
import { AlignLeft, ArrowUp } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import type { TocHeading } from "@/lib/documents/toc";
import { useScrollspy } from "@/lib/hooks/use-scrollspy";

export type TableOfContentsProps = {
  headings: TocHeading[];
  className?: string;
  onItemClick?: (id: string) => void;
  title?: string;
  showProgress?: boolean;
};

export function TableOfContents({
  headings,
  className,
  onItemClick,
  title = "On this page",
  showProgress = true,
}: TableOfContentsProps) {
  const headingIds = useMemo(() => headings.map((h) => h.id), [headings]);
  const { activeId, readingProgress, scrollToHeading, scrollToTop } =
    useScrollspy(headingIds);

  const minLevel = useMemo(() => {
    if (headings.length === 0) return 1;
    return Math.min(...headings.map((h) => h.level));
  }, [headings]);

  if (headings.length === 0) {
    return null;
  }

  const handleLinkClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) => {
    e.preventDefault();
    scrollToHeading(id);
    onItemClick?.(id);
  };

  return (
    <nav
      aria-label="Table of contents"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border/70 bg-card/60 p-3.5 text-xs backdrop-blur-xs shadow-xs",
        className,
      )}
    >
      {/* Header with Title, Progress, and Back to Top button */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <AlignLeft className="size-3.5 text-primary shrink-0" />
          <span className="font-semibold text-xs tracking-tight">{title}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {showProgress && (
            <span
              className="text-[10px] tabular-nums font-mono text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded border border-border/50"
              title="Reading progress"
            >
              {readingProgress}%
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={scrollToTop}
            className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground gap-1"
            title="Scroll to top of document"
          >
            <ArrowUp className="size-3" />
            <span className="hidden sm:inline">Top</span>
          </Button>
        </div>
      </div>

      {/* Mini reading progress track */}
      {showProgress && (
        <div className="-mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted/60">
          <div
            className="h-full bg-primary transition-all duration-150 ease-out"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
      )}

      {/* Scrollable list of headings */}
      <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-1 space-y-0.5 relative border-l border-border/60 ml-1.5 pl-2">
        {headings.map((heading) => {
          const isActive = activeId === heading.id;
          const depth = Math.max(0, Math.min(3, heading.level - minLevel));

          const depthPadding =
            depth === 0
              ? "pl-1.5"
              : depth === 1
                ? "pl-3.5"
                : depth === 2
                  ? "pl-5"
                  : "pl-6.5";

          return (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              onClick={(e) => handleLinkClick(e, heading.id)}
              aria-current={isActive ? "location" : undefined}
              title={heading.text}
              className={cn(
                "group relative block py-1 pr-1.5 text-xs transition-colors rounded-r-md leading-snug line-clamp-2",
                depthPadding,
                isActive
                  ? "font-medium text-primary bg-primary/10 border-l-2 border-primary -ml-[9px] pl-3"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              {heading.text}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
