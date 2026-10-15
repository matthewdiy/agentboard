"use client";

import { useEffect, useState } from "react";
import { AlignLeft, ArrowUp } from "lucide-react";

import { TableOfContents } from "@/components/table-of-contents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { TocHeading } from "@/lib/documents/toc";

export type FloatingTocProps = {
  headings: TocHeading[];
  className?: string;
};

export function FloatingToc({ headings, className }: FloatingTocProps) {
  const [open, setOpen] = useState(false);
  const [showTopButton, setShowTopButton] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkScroll = () => {
      setShowTopButton(window.scrollY > 350);
    };

    window.addEventListener("scroll", checkScroll, { passive: true });
    return () => window.removeEventListener("scroll", checkScroll);
  }, []);

  if (headings.length < 2) {
    return null;
  }

  const handleScrollTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div
      className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 xl:hidden ${className ?? ""}`}
    >
      {/* Scroll to top button - appears after scrolling down */}
      {showTopButton && (
        <Button
          variant="outline"
          size="icon"
          onClick={handleScrollTop}
          className="size-9 rounded-full border border-border/80 bg-background/90 backdrop-blur-md shadow-md text-muted-foreground hover:text-foreground transition-all hover:scale-105"
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <ArrowUp className="size-4" />
        </Button>
      )}

      {/* Sheet Trigger for Outline */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border border-border/80 bg-background/90 px-3.5 backdrop-blur-md shadow-md text-xs font-medium gap-1.5 hover:border-primary/50 hover:bg-background transition-all hover:scale-105"
            aria-label="Open Table of Contents"
          >
            <AlignLeft className="size-3.5 text-primary" />
            <span>Outline</span>
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 font-mono h-4 bg-muted/80"
            >
              {headings.length}
            </Badge>
          </Button>
        </SheetTrigger>

        <SheetContent side="right" className="w-80 sm:w-96 p-5 flex flex-col">
          <SheetHeader className="p-0 pb-3 border-b border-border/60">
            <SheetTitle className="text-sm font-semibold flex items-center gap-2">
              <AlignLeft className="size-4 text-primary" />
              Table of Contents
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Jump directly to any section in this document
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-4 pr-1">
            <TableOfContents
              headings={headings}
              onItemClick={() => setOpen(false)}
              className="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
