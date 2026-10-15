"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UseScrollspyOptions = {
  /**
   * Offset from top of viewport in pixels when calculating active heading.
   * Accounts for sticky headers and comfortable reading position.
   * Default: 100
   */
  offset?: number;
};

export type UseScrollspyReturn = {
  activeId: string;
  readingProgress: number;
  scrollToHeading: (id: string) => void;
  scrollToTop: () => void;
};

export function useScrollspy(
  headingIds: string[],
  options: UseScrollspyOptions = {},
): UseScrollspyReturn {
  const { offset = 100 } = options;

  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const currentHash = window.location.hash.replace(/^#/, "");
      if (currentHash && headingIds.includes(currentHash)) {
        return currentHash;
      }
    }
    return headingIds[0] ?? "";
  });

  const [readingProgress, setReadingProgress] = useState<number>(0);

  const isManualScrollingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Smoothly scroll to a specific heading
  const scrollToHeading = useCallback(
    (id: string) => {
      if (typeof window === "undefined") return;

      setActiveId(id);
      isManualScrollingRef.current = true;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const element = document.getElementById(id);
      if (element) {
        const topOffset = offset;
        const elementPosition = element.getBoundingClientRect().top;
        const targetScrollTop = elementPosition + window.pageYOffset - topOffset;

        window.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: "smooth",
        });

        // Update URL hash without causing a jarring native jump
        if (window.history && window.history.pushState) {
          window.history.pushState(null, "", `#${id}`);
        }
      }

      // Re-enable scroll listener after the smooth scroll finishes
      timeoutRef.current = setTimeout(() => {
        isManualScrollingRef.current = false;
      }, 750);
    },
    [offset],
  );

  const scrollToTop = useCallback(() => {
    if (typeof window === "undefined") return;

    if (headingIds.length > 0 && headingIds[0]) {
      setActiveId(headingIds[0]);
    }
    isManualScrollingRef.current = true;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    if (window.history && window.history.pushState) {
      window.history.pushState(null, "", window.location.pathname);
    }

    timeoutRef.current = setTimeout(() => {
      isManualScrollingRef.current = false;
    }, 750);
  }, [headingIds]);

  useEffect(() => {
    if (typeof window === "undefined" || headingIds.length === 0) return;

    let rafId: number | null = null;

    const updateActiveHeading = () => {
      // Calculate reading progress percentage
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollableDistance = docHeight - winHeight;

      if (scrollableDistance > 0) {
        const pct = Math.min(
          100,
          Math.max(0, Math.round((scrollTop / scrollableDistance) * 100)),
        );
        setReadingProgress(pct);
      }

      if (isManualScrollingRef.current) return;

      // 1. If user is at or very near bottom of document, highlight the last heading
      const atBottom = docHeight - (scrollTop + winHeight) < 40;
      if (atBottom) {
        const lastId = headingIds[headingIds.length - 1];
        if (lastId) {
          setActiveId(lastId);
        }
        return;
      }

      // 2. Iterate through headings and determine which one is currently in view
      let current = headingIds[0] ?? "";
      for (const id of headingIds) {
        const el = document.getElementById(id);
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        // If the heading top is at or above our threshold offset, it's passed the trigger point
        if (rect.top <= offset + 15) {
          current = id;
        } else {
          // Headings are listed sequentially, so break once a heading is below the threshold
          break;
        }
      }

      if (current) {
        setActiveId(current);
      }
    };

    const handleScroll = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(updateActiveHeading);
    };

    // Defer initial calculation to animation frame to avoid synchronous effect renders
    rafId = requestAnimationFrame(updateActiveHeading);

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [headingIds, offset]);

  return {
    activeId,
    readingProgress,
    scrollToHeading,
    scrollToTop,
  };
}
