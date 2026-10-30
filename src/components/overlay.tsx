"use client";

// The portal's two overlays: a side panel (Drawer) for forms and details, and a
// pop-up (Modal) for small, focused tasks.
//
// They replace forms that used to open INLINE — below or above the list,
// pushing the page around — where opening a second one stacked it on the
// first and nobody could tell what was open or where they had clicked. An
// overlay answers both: it sits above the page, says what it is in its title,
// and there is only ever one, because each screen keeps a single "what is
// open" state and opening something new replaces it.
//
// Both close on Escape, on the backdrop and on ✕; both stop the page behind
// from scrolling; both put the title, the body and the actions in fixed places
// so a long form keeps its Save button in reach.
//
// Rendered into <body> through a portal. Opened from inside a card, an overlay
// inherits that card's layout — a parent's `space-y-4` alone pushed every panel
// 16px down and left an undimmed strip across the top of the page.
//
// How they move (Apple, "Designing Fluid Interfaces"; the curves and timings
// are in globals.css under "Overlays"):
//  - They leave the way they came — the panel back out to the right, the
//    pop-up back down — instead of vanishing. usePresence keeps them mounted
//    for the exit; the content they showed stays with them on the way out.
//  - The motion is a transition, so reopening mid-exit turns it round from
//    where it is.
//  - The panel can be swiped away by its header: it tracks the pointer 1:1,
//    resists being pulled the wrong way, and on release a spring finishes the
//    job at the speed of the swipe — closing if the swipe was heading out.
//  - The divider under the header appears only once the body has scrolled
//    under it; the one over the footer only while there is more below.
//  - Tab stays inside, and focus goes back to whatever opened it.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePresence } from "@/lib/use-presence";
import { animateSpring, releaseVelocity, rubberband, shouldDismiss, SPRINGS } from "@/lib/motion";

const WIDTHS = { md: "w-[460px]", lg: "w-[620px]", xl: "w-[880px]" } as const;
const SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

// How long each exit plays before the overlay is removed (globals.css).
const DRAWER_EXIT_MS = 300;
const MODAL_EXIT_MS = 170;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useOverlay(open: boolean, mounted: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, read when needed. Callers pass a fresh arrow on every
  // render, and with it in the effect's dependencies every keystroke in a
  // form re-ran the effect — whose 30ms focus step then pulled the caret back
  // to the first field mid-word.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || !mounted) return;
    const onClose = () => close.current();
    // Whatever had focus, so closing puts the keyboard back where it was.
    const restoreTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !panel.current) return;
      // Keep Tab inside: the page behind is still there, and reaching it by
      // keyboard would act on something the person cannot see.
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => n.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    // The page behind stays where it was: no scrolling it by accident while
    // the overlay is open, and no losing your place when it closes.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus moves into the overlay so the keyboard is where the eyes are.
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea, select, [data-autofocus]");
      (first ?? panel.current)?.focus({ preventScroll: true });
    }, 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
      if (restoreTo && document.contains(restoreTo)) requestAnimationFrame(() => restoreTo.focus({ preventScroll: true }));
    };
  }, [open, mounted]);
  return panel;
}

/** What the overlay showed while open, kept for its exit — the caller's state is usually already gone. */
function useHeld<T>(value: T, open: boolean): T {
  const held = useRef(value);
  if (open) held.current = value;
  return open ? value : held.current;
}

/** Whether the scrolling body has content above / below the visible part. */
function useScrollEdges() {
  const [edges, setEdges] = useState({ above: false, below: false });
  const ref = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const above = el.scrollTop > 1;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges(e => (e.above === above && e.below === below ? e : { above, below }));
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => ro?.disconnect();
  });
  return { ref, edges, onScroll: measure };
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Actions pinned to the bottom (Save, Cancel…). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** A panel that slides in from the right: forms, editors and detail views. */
export function Drawer({ open, onClose, title, subtitle, footer, children, width = "lg" }: OverlayProps & { width?: keyof typeof WIDTHS }) {
  const { mounted, shown } = usePresence(open, DRAWER_EXIT_MS);
  const panel = useOverlay(open, mounted, onClose);
  const titleId = useId();
  const view = useHeld({ title, subtitle, footer, children }, open);
  const body = useScrollEdges();
  const scrim = useRef<HTMLDivElement>(null);

  // ── Swipe to dismiss ───────────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; startX: number; startY: number; from: number; active: boolean; samples: { t: number; x: number }[] } | null>(null);
  const offset = useRef(0);
  const stopSpring = useRef<(() => void) | null>(null);

  const place = useCallback((x: number) => {
    offset.current = x;
    const el = panel.current;
    if (!el) return;
    el.style.transform = x ? `translateX(${x}px)` : "";
    if (scrim.current) scrim.current.style.opacity = x ? String(Math.max(0, 1 - x / Math.max(1, el.offsetWidth))) : "";
  }, [panel]);

  // A fresh open starts from a clean slate, whatever the last swipe left.
  useEffect(() => { if (open) { stopSpring.current?.(); place(0); setDragging(false); } }, [open, place]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !open) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, [role=button]")) return;
    stopSpring.current?.();   // grabbed mid-flight: carry on from where it is
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, from: offset.current, active: offset.current !== 0, samples: [{ t: e.timeStamp, x: e.clientX }] };
    if (drag.current.active) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDragging(true); }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.active) {
      // A few pixels of intent first, and sideways intent: an upward drag or a
      // wobbly click is not a swipe.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    }
    const raw = d.from + dx;
    const width = panel.current?.offsetWidth ?? 600;
    place(raw >= 0 ? raw : rubberband(raw, width));
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    if (d.samples.length > 12) d.samples.shift();
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || e.pointerId !== d.id || !d.active) return;
    const width = panel.current?.offsetWidth ?? 600;
    const velocity = releaseVelocity(d.samples);
    const close = shouldDismiss(offset.current, velocity, width);
    stopSpring.current = animateSpring(offset.current, close ? width : 0, velocity, place, SPRINGS.sheet, () => {
      stopSpring.current = null;
      if (close) onClose();
      else { place(0); setDragging(false); }
    });
  }

  if (!mounted || typeof document === "undefined") return null;
  const state = shown ? { "data-shown": "" } : {};
  return createPortal(
    <>
      <div ref={scrim} className="ov-scrim fixed inset-0 bg-ink-950/25 z-40" {...state} onClick={onClose} aria-hidden />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} {...state} data-dragging={dragging || undefined}
        className={`ov-drawer fixed inset-y-0 right-0 ${WIDTHS[width]} max-w-full bg-white border-l border-line shadow-2xl z-50 flex flex-col outline-none`}>
        <header onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          className={`ov-grab flex items-start gap-3 px-5 py-4 border-b shrink-0 transition-colors ${body.edges.above ? "border-line" : "border-transparent"}`}>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold text-ink-900 leading-tight">{view.title}</h2>
            {view.subtitle && <p className="text-xs text-slate-500 mt-0.5">{view.subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -m-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </header>
        <div ref={body.ref} onScroll={body.onScroll} className="flex-1 overflow-y-auto overscroll-contain px-5 py-4"><div>{view.children}</div></div>
        {view.footer && <footer className={`px-5 py-3 border-t bg-white shrink-0 flex items-center gap-2 transition-colors ${body.edges.below ? "border-line" : "border-transparent"}`}>{view.footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}

/** A centred pop-up: small, focused tasks — add one thing, confirm one change. */
export function Modal({ open, onClose, title, subtitle, footer, children, size = "md" }: OverlayProps & { size?: keyof typeof SIZES }) {
  const { mounted, shown } = usePresence(open, MODAL_EXIT_MS);
  const panel = useOverlay(open, mounted, onClose);
  const titleId = useId();
  const view = useHeld({ title, subtitle, footer, children }, open);
  const body = useScrollEdges();
  if (!mounted || typeof document === "undefined") return null;
  const state = shown ? { "data-shown": "" } : {};
  return createPortal(
    <div className="ov-frame fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" {...state}>
      <div className="ov-scrim fixed inset-0 bg-ink-950/30" {...state} onClick={onClose} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} {...state}
        className={`ov-modal relative w-full ${SIZES[size]} bg-white rounded-card border border-line shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] outline-none`}>
        <header className={`flex items-start gap-3 px-5 py-4 border-b shrink-0 transition-colors ${body.edges.above ? "border-line" : "border-transparent"}`}>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold text-ink-900 leading-tight">{view.title}</h2>
            {view.subtitle && <p className="text-xs text-slate-500 mt-0.5">{view.subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -m-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </header>
        <div ref={body.ref} onScroll={body.onScroll} className="flex-1 overflow-y-auto overscroll-contain px-5 py-4"><div>{view.children}</div></div>
        {view.footer && <footer className={`px-5 py-3 border-t shrink-0 flex items-center gap-2 transition-colors ${body.edges.below ? "border-line" : "border-transparent"}`}>{view.footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
