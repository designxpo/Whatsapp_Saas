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

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const WIDTHS = { md: "w-[460px]", lg: "w-[620px]", xl: "w-[880px]" } as const;
const SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

function useOverlay(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // The page behind stays where it was: no scrolling it by accident while
    // the overlay is open, and no losing your place when it closes.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus moves into the overlay so the keyboard is where the eyes are.
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea, select, [data-autofocus]");
      (first ?? panel.current)?.focus();
    }, 30);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; clearTimeout(t); };
  }, [open, onClose]);
  return panel;
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
  const panel = useOverlay(open, onClose);
  const titleId = useId();
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 bg-ink-950/25 z-40 u-fade-in" onClick={onClose} aria-hidden />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`fixed inset-y-0 right-0 ${WIDTHS[width]} max-w-full bg-white border-l border-line shadow-2xl z-50 flex flex-col outline-none u-slide-in-right`}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold text-ink-900 leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -m-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line bg-white shrink-0 flex items-center gap-2">{footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}

/** A centred pop-up: small, focused tasks — add one thing, confirm one change. */
export function Modal({ open, onClose, title, subtitle, footer, children, size = "md" }: OverlayProps & { size?: keyof typeof SIZES }) {
  const panel = useOverlay(open, onClose);
  const titleId = useId();
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-ink-950/30 u-fade-in" onClick={onClose} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`relative w-full ${SIZES[size]} bg-white rounded-card border border-line shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] outline-none u-scale-in`}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold text-ink-900 leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -m-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-line shrink-0 flex items-center gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
