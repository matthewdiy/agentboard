"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const defaultResetMs = 1600;

/**
 * Copy-to-clipboard with a short-lived "copied" key, so several buttons on one
 * screen can share a single piece of confirmation state.
 */
export function useCopyToClipboard(resetAfterMs = defaultResetMs) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timeout = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeout.current !== null) window.clearTimeout(timeout.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setCopiedKey(null), resetAfterMs);
    },
    [resetAfterMs],
  );

  return { copiedKey, copy };
}
