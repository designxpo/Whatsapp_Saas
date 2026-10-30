"use client";

// Two small pieces of navigation motion (styles in globals.css).
//
// useSlidingPill: the sidebar's active pill moves to the section picked
// instead of reappearing there, so the eye is carried from where you were to
// where you are. It is one element behind the items, placed on the active one
// by measurement; the first placement does not animate (nothing slides in
// from the top on load), every later one does. `axis: "xy"` is for a nav that
// is a column on desktop and a row on phones (the owner console): the pill
// follows both position and size, and is measured again when the layout changes.
//
// useScrolled: whether the page has scrolled, for the top bar's edge — a
// divider that appears only once content is underneath it.

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

export function useSlidingPill(container: RefObject<HTMLElement | null>, activeKey: string, deps: unknown[] = [], axis: "y" | "xy" = "y") {
  const [box, setBox] = useState<{ top: number; height: number; left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const item = container.current?.querySelector<HTMLElement>(`[data-nav-key="${CSS.escape(activeKey)}"]`);
      setBox(item ? { top: item.offsetTop, height: item.offsetHeight, left: item.offsetLeft, width: item.offsetWidth } : null);
    };
    measure();
    if (axis !== "xy" || typeof ResizeObserver === "undefined" || !container.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, axis, ...deps]);

  // Animate only after the first placement has painted.
  useEffect(() => {
    if (!box || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [box, ready]);

  const style = !box ? { opacity: 0 }
    : axis === "xy" ? { transform: `translate(${box.left}px, ${box.top}px)`, width: box.width, height: box.height }
    : { transform: `translateY(${box.top}px)`, height: box.height };
  return { style, ready };
}

export function useScrolled(threshold = 2): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > threshold);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);
  return scrolled;
}
