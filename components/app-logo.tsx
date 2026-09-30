import * as React from "react";
import { cn } from "cn";

export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-6 shrink-0", className)}
      aria-hidden="true"
    >
      {/* Background container: emerald green */}
      <rect
        width="32"
        height="32"
        rx="7"
        fill="#059669"
      />
      {/* Back document sheet in white */}
      <rect
        x="7.5"
        y="6"
        width="13.5"
        height="16.5"
        rx="2"
        fill="#ffffff"
        fillOpacity="0.45"
      />
      {/* Front primary board/document in solid white */}
      <rect
        x="11"
        y="9.5"
        width="13.5"
        height="16.5"
        rx="2"
        fill="#ffffff"
      />
      {/* Detail lines on the front document sheet in deep emerald */}
      <rect
        x="14"
        y="13.5"
        width="7.5"
        height="1.5"
        rx="0.75"
        fill="#047857"
      />
      <rect
        x="14"
        y="17"
        width="5.5"
        height="1.5"
        rx="0.75"
        fill="#047857"
      />
      <rect
        x="14"
        y="20.5"
        width="4"
        height="1.5"
        rx="0.75"
        fill="#047857"
      />
    </svg>
  );
}

export function AppLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="14"
        height="17"
        rx="2.5"
        className="stroke-emerald-600 dark:stroke-emerald-500"
        strokeWidth="1.75"
      />
      <rect
        x="7"
        y="6"
        width="14"
        height="17"
        rx="2.5"
        className="fill-emerald-600/15 stroke-emerald-600 dark:fill-emerald-500/20 dark:stroke-emerald-400"
        strokeWidth="1.75"
      />
      <line
        x1="10.5"
        y1="11"
        x2="17.5"
        y2="11"
        className="stroke-emerald-600 dark:stroke-emerald-400"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="10.5"
        y1="14.5"
        x2="15.5"
        y2="14.5"
        className="stroke-emerald-600 dark:stroke-emerald-400"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
