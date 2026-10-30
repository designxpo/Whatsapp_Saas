import type { KeyboardEvent } from "react";

/**
 * A table row that opens something. Reachable by Tab and opened with Enter or
 * Space, like a button (Apple, Accessibility: "let people use the keyboard
 * alone"), and it answers the press itself, not only the release. A key press
 * inside the row (its checkbox) stays with that control.
 */
export function openRow(open: () => void) {
  return {
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      open();
    },
    className: "cursor-pointer transition-colors hover:bg-canvas active:bg-brand-50",
  };
}
