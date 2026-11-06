"use client";

// The portal's current section, kept in the address bar (?tab=flows).
//
// The section used to live only in React state, so a refresh, a restored
// browser tab or a link someone shared all landed on Home, and whoever was
// three screens deep had to find their way back. Now the URL says where you
// are: refreshing stays put, Back and Forward move between sections, and a
// link opens the section it names.
//
// The URL is a suggestion, not a permission: the shell's canOpenTab guard
// still decides whether this person may see the section, exactly as for a
// click. An unknown or misspelt ?tab= is ignored and Home is shown.

import { useEffect, useLayoutEffect, useRef } from "react";

const PARAM = "tab";

/** Query parameters that belong to one screen, and that screen. */
const TAB_SCOPED: Record<string, string> = { section: "settings" };

/** The section a query string names, if it is one of `valid`. Pure. */
export function tabFromSearch<T extends string>(search: string, valid: readonly T[]): T | null {
  const v = new URLSearchParams(search).get(PARAM);
  return v && (valid as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * The query string for being on `tab`, keeping every other parameter (a
 * return from Meta's signup, a deep link's own values). Home is the bare
 * address. Pure.
 */
export function searchWithTab(search: string, tab: string, home: string): string {
  const q = new URLSearchParams(search);
  if (tab === home) q.delete(PARAM); else q.set(PARAM, tab);
  // A parameter that belongs to one screen leaves with it (?section= is
  // Settings' own), so another screen's address never carries it along.
  for (const [param, owner] of Object.entries(TAB_SCOPED)) if (tab !== owner) q.delete(param);
  const s = q.toString();
  return s ? `?${s}` : "";
}

// useLayoutEffect warns during server rendering; the restore only matters in
// the browser, where it runs before paint so Home never flashes first.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keep `tab` and the address bar in step.
 *  - On load: open the section the URL names (before the first paint).
 *  - On a change: push a history entry, so Back returns to the last section.
 *  - On Back / Forward: show the section the URL now names.
 */
export function useTabInUrl<T extends string>(tab: T, setTab: (t: T) => void, valid: readonly T[], home: T): void {
  const validRef = useRef(valid);
  validRef.current = valid;

  // The section the URL asked for on load, until the shell is showing it.
  // While it is pending, nothing is written back: the first renders (and
  // React's development double-run of effects) still show Home, and writing
  // that would erase the very ?tab= being restored.
  const pending = useRef<T | null>(null);

  useBrowserLayoutEffect(() => {
    const fromUrl = tabFromSearch(window.location.search, validRef.current);
    if (fromUrl && fromUrl !== home) { pending.current = fromUrl; setTab(fromUrl); }
    // Mount only: later changes come from the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pending.current) {
      if (tab !== pending.current) return;
      pending.current = null;
    }
    const next = searchWithTab(window.location.search, tab, home);
    if (next === window.location.search) return;   // already there (a Back press, or the restore)
    window.history.pushState(window.history.state, "", `${window.location.pathname}${next}${window.location.hash}`);
  }, [tab, home]);

  useEffect(() => {
    const onPop = () => setTab(tabFromSearch(window.location.search, validRef.current) ?? home);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setTab, home]);
}
