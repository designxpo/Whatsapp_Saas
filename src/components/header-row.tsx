// The "title and description on the left, buttons on the right" row that
// heads most portal cards and pages — made to survive a phone.
//
// Written by hand in each tab, that row was `flex justify-between` with the
// buttons `shrink-0`: on a 390px phone the buttons kept their full width, so
// the description was squeezed into a 90px column and the last buttons were
// pushed off the screen (and clipped, since <main> hides sideways overflow).
// Below 640px this stacks: text first, then the buttons, wrapping onto as many
// lines as they need. From 640px up it is the usual side-by-side row.
import type { ReactNode } from "react";

export function HeaderRow({ children, actions, className = "", align = "center" }: {
  /** The title + description block. */
  children: ReactNode;
  /** Buttons, selects, badges. Omit for a text-only header. */
  actions?: ReactNode;
  className?: string;
  /** Vertical alignment of the two halves on wider screens. */
  align?: "center" | "start";
}) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:justify-between ${align === "start" ? "sm:items-start" : "sm:items-center"} ${className}`}>
      <div className="min-w-0 sm:flex-1">{children}</div>
      {actions != null && actions !== false && <ActionRow className="sm:justify-end sm:shrink-0 sm:max-w-[65%]">{actions}</ActionRow>}
    </div>
  );
}

/** A group of buttons that wraps onto new lines instead of running off the screen. */
export function ActionRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 min-w-0 ${className}`}>{children}</div>;
}
