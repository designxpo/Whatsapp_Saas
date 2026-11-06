"use client";

// One group in Live Chat's contact-details pane. Every group shares one label
// style (11px, uppercase, secondary), so the pane reads as quiet sections
// rather than a wall of controls. A collapsible group remembers whether it was
// open in this browser, so an agent who never reads Automations can fold it
// away once and keep it folded.

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

const KEY = "talko-details-open:";

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(KEY + id) : null;
    return v === "1" ? true : v === "0" ? false : fallback;
  } catch { return fallback; }
}

/** The one label style every details group uses. */
export const detailsLabel = "text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-500";

/**
 * A titled group. `collapsible` adds a disclosure chevron and remembers the
 * choice under `id`. `meta` sits at the right of the title (a count, a hint).
 * No icons in the labels: words alone keep the pane calm.
 */
export function DetailsSection({ id, title, collapsible = false, defaultOpen = true, meta, children }: {
  id: string;
  title: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => (collapsible ? readOpen(id, defaultOpen) : true));
  const bodyId = useId();
  useEffect(() => {
    if (!collapsible) return;
    try { window.localStorage.setItem(KEY + id, open ? "1" : "0"); } catch { /* private mode: this visit only */ }
  }, [collapsible, id, open]);

  const label = <span className="truncate">{title}</span>;

  return (
    <section className="min-w-0">
      {collapsible ? (
        <h3 className="m-0">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={bodyId}
            className={`group w-full flex items-center gap-1.5 min-h-11 md:min-h-7 -mx-1 px-1 rounded-md text-left hover:text-ink-800 ${detailsLabel}`}>
            <ChevronRight aria-hidden className={`w-3.5 h-3.5 shrink-0 text-ink-400 motion-safe:transition-transform ${open ? "rotate-90" : ""}`} />
            {label}
            {meta != null && <span className="ml-auto normal-case tracking-normal font-normal text-[12px] text-ink-500 tabular-nums">{meta}</span>}
          </button>
        </h3>
      ) : (
        <h3 className={`flex items-center gap-1.5 min-h-7 m-0 ${detailsLabel}`}>
          {label}
          {meta != null && <span className="ml-auto normal-case tracking-normal font-normal text-[12px] text-ink-500 tabular-nums">{meta}</span>}
        </h3>
      )}
      <div id={bodyId} hidden={!open} className="mt-1">
        {children}
      </div>
    </section>
  );
}

/**
 * One inspector row — a label on the left and its control on the right, the
 * way a Mac inspector lays out settings. The control is passed as children
 * and must carry the `id` given here so the label names it.
 */
export function DetailsRow({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <label htmlFor={htmlFor} className="w-24 shrink-0 text-[13px] md:text-[12px] text-ink-500 truncate">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** Controls inside the pane: roomy on a phone, 32px on a tablet, 28–30px with a mouse. */
export const detailsControl = "w-full h-11 md:h-8 lg:h-[30px] rounded-[8px] border border-line bg-white px-2.5 text-base md:text-[13px] text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60";
/** A small bordered button in the pane. */
export const detailsButton = "inline-flex items-center justify-center gap-1.5 h-11 md:h-8 lg:h-[30px] px-3 rounded-[8px] border border-line bg-white text-[14px] md:text-[13px] font-medium text-ink-800 hover:bg-canvas disabled:opacity-50";
