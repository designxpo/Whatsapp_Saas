"use client";

// Open another portal section from a screen the shell didn't hand `goTo` to.
//
// The shell keeps the section in the address bar (?tab=…) and follows Back /
// Forward through a popstate listener (lib/tab-url.ts). So writing the new
// ?tab= and firing popstate moves the shell exactly as Back would — and the
// shell's own permission guard still decides what is shown. When the screen
// does have `goTo`, that is used instead.

import type { GoTo, Tab } from "@/app/admin/_shared";

export function openTab(tab: Tab, goTo?: GoTo): void {
  if (goTo) { goTo(tab); return; }
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  q.set("tab", tab);
  window.history.pushState(window.history.state, "", `${window.location.pathname}?${q}${window.location.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
