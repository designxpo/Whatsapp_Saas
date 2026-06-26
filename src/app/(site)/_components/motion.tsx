"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

// useLayoutEffect on the client (so the initial parallax position is applied
// before the browser paints → no on-load "snap"); useEffect on the server.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ── Shared scroll dispatcher ────────────────────────────────────────────────
// One window 'scroll' + 'resize' listener and ONE requestAnimationFrame loop
// for the whole page, instead of one per <Parallax>/SiteBackground (which was
// ~11 listeners + 11 rAFs + 11 setStates per scroll frame). Subscribers run
// inside a single rAF callback, so every getBoundingClientRect() read happens
// back-to-back in one batch with no interleaved style writes — the browser does
// at most one layout flush per frame instead of risking one per handler.
//
// Disabled (never schedules, never reads) under prefers-reduced-motion: the
// store simply stays at scrollY 0 / version 0 forever.
type Subscriber = () => void;

let subscribers: Subscriber[] = [];
let scrollY = 0;
let version = 0; // bumped once per committed frame; lets hooks resubscribe-read cheaply
let raf = 0;
let listening = false;
let reduced = false;

function flush() {
  raf = 0;
  // Under reduced-motion we report a constant scrollY of 0 so every subscriber
  // settles to its neutral position (no drift) and stays there.
  scrollY = (typeof window === "undefined" || reduced) ? 0 : window.scrollY;
  version++;
  // Snapshot so a subscriber unsubscribing mid-flush can't shift the array.
  for (const fn of subscribers.slice()) fn();
}

function schedule() {
  if (raf || reduced) return;
  raf = requestAnimationFrame(flush);
}

// React to the OS reduced-motion setting flipping while the page is open:
// turning it ON freezes everything at neutral (one reset flush); OFF resumes.
function setReduced(v: boolean) {
  if (reduced === v) return;
  reduced = v;
  if (reduced) { if (raf) { cancelAnimationFrame(raf); raf = 0; } flush(); } // push neutral once
  else schedule();
}

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  reduced = mql?.matches ?? false;
  mql?.addEventListener?.("change", e => setReduced(e.matches));
  // Listeners stay attached for the page lifetime (one cheap pair); schedule()
  // is a no-op while reduced, so this is free under reduced-motion.
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  schedule(); // prime initial positions (no-op if reduced)
}

// Subscribe a callback that runs once per scroll/resize frame. Returns an
// unsubscribe. The first subscriber wires up the global listeners; the listeners
// stay attached for the page lifetime (cheap — a single pair) once armed.
function subscribe(fn: Subscriber): () => void {
  ensureListening();
  subscribers.push(fn);
  return () => { subscribers = subscribers.filter(s => s !== fn); };
}

// Fade-and-rise on scroll. Starts hidden, reveals once when it enters the
// viewport. `delay` (ms) staggers siblings. The `data-reveal` attribute lets the
// reduced-motion CSS rule force it visible. Falls back to visible if there's no
// IntersectionObserver support.
export function Reveal({
  children, delay = 0, className = "", as: Tag = "div",
}: { children: React.ReactNode; delay?: number; className?: string; as?: "div" | "section" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Comp = Tag as React.ElementType;
  return (
    <Comp
      ref={ref}
      data-reveal
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"} ${className}`}
    >
      {children}
    </Comp>
  );
}

// Subscribe to the shared dispatcher's frame counter. SiteBackground (and any
// consumer that only needs window.scrollY) uses this — it pays no
// getBoundingClientRect cost. Returns the latest scrollY.
export function useScrollY(): number {
  return useSyncExternalStore(
    subscribe,
    () => scrollY,
    () => 0, // SSR
  );
}

// Tracks how far `ref` is through the viewport, as p ∈ ~[-1, 1] (−1 below the
// fold, 0 centred, +1 above). `ref` must sit on a NON-transformed element
// (e.g. the section) so the measurement stays stable; apply the resulting
// offset to child layers. Returns 0 forever under prefers-reduced-motion.
//
// Reads its rect inside the SHARED rAF frame (one listener for the whole page),
// so N parallax layers cost one listener + one rAF + N batched rect reads per
// frame instead of N listeners × N rAFs.
export function useParallax(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  // Layout effect → the initial position is computed before paint, so the
  // element never "snaps" from 0 to its real offset on hydration. Always
  // subscribes (even under reduced-motion) so a live OS toggle is honoured;
  // `measure` returns 0 while reduced, which freezes the layer at neutral.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    let last = NaN;
    const measure = () => {
      if (reduced) { if (last !== 0) { last = 0; setP(0); } return; }
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const next = Math.round(((vh / 2 - (r.top + r.height / 2)) / (vh / 2 + r.height / 2)) * 1000) / 1000; // ~ -1..1
      if (next !== last) { last = next; setP(next); } // skip no-op renders (e.g. far off-screen layers)
    };
    measure(); // initial position (before paint)
    return subscribe(measure);
  }, [ref]);
  return p;
}

// Drop-in scroll parallax for DECORATIVE layers. Drifts its children by up to
// `speed` px as the layer crosses the viewport. The outer (tracked) element is
// never transformed — only the inner wrapper moves — so measurement can't feed
// back on itself. Disabled under reduced-motion. Typical use:
//   <Parallax speed={90} className="pointer-events-none absolute inset-0">
//     <div className="absolute -left-16 top-8 h-72 w-72 rounded-full bg-[#7c5cff]/15 blur-3xl" />
//   </Parallax>
export function Parallax({
  speed = 60, className = "", children,
}: { speed?: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useParallax(ref);
  return (
    <div ref={ref} aria-hidden className={className}>
      <div className="relative h-full w-full" style={{ transform: `translate3d(0, ${(p * speed).toFixed(1)}px, 0)` }}>
        {children}
      </div>
    </div>
  );
}
