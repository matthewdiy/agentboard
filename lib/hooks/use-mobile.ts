import { useSyncExternalStore } from "react";

const mobileBreakpoint = 768;
const mobileQuery = `(max-width: ${mobileBreakpoint - 1}px)`;

function subscribe(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(mobileQuery);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

/**
 * Subscribes to the viewport instead of mirroring it into state, so there is no
 * post-mount render and the sidebar renders its desktop layout on the server.
 */
export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(mobileQuery).matches,
    () => false,
  );
}
