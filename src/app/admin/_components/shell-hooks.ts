"use client";

// Small hooks for the portal shell: screen width, the phone menu's keyboard
// handling, the Today summary every badge and Home read, and a clock tick for
// "Updated 2 min ago".

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TodayItemLike } from "./shell-logic";

/** Tailwind's lg: the sidebar is a fixed column at this width and up. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Whether a media query matches; false on the server and before mount. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const read = () => setMatches(mq.matches);
    read();
    mq.addEventListener?.("change", read);
    return () => mq.removeEventListener?.("change", read);
  }, [query]);
  return matches;
}

/** Re-render every `ms` so relative times ("5 min ago") stay true. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The phone menu as a proper dialog while it is open: focus moves in, Tab
 * stays inside, Escape closes it, the page behind doesn't scroll, and focus
 * goes back to the button that opened it.
 */
export function useDrawerFocus(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => n.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
      if (restoreTo && document.contains(restoreTo) && restoreTo.offsetParent !== null) restoreTo.focus({ preventScroll: true });
    };
  }, [open, panel]);
}

export interface TodaySummary {
  items: TodayItemLike[];
  counts: { overdue: number; dueToday: number; unassigned: number; mine: number };
}

/**
 * /api/admin/today, every minute and on coming back to the tab. One copy for
 * the whole shell: the Today badge and Home's "What needs you" read the same
 * answer, so they can't disagree.
 */
export function useTodaySummary(enabled: boolean) {
  const [data, setData] = useState<TodaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const live = useRef(true);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/today", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!live.current) return;
      if (!r.ok || !j || j.error || !j.counts) { setError((j && j.error) || "Couldn't load today's work."); return; }
      setData({ items: Array.isArray(j.items) ? j.items : [], counts: j.counts });
      setError(null);
      setUpdatedAt(Date.now());
    } catch {
      if (live.current) setError("Couldn't reach the server.");
    }
  }, []);
  useEffect(() => {
    live.current = true;
    if (!enabled) return;
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live.current = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, load]);
  return { data, error, updatedAt, overdue: data?.counts.overdue ?? 0, refresh: load };
}
