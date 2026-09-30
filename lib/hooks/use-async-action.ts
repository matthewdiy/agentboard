"use client";

import { useCallback, useState } from "react";

/**
 * Pending/error bookkeeping for a single user-triggered request. `run` resolves
 * to whether the action succeeded, so callers can decide to close a dialog.
 */
export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Something went wrong.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, setError };
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
