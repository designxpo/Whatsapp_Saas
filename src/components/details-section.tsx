"use client";

// One group in Live Chat's contact-details pane. Every group shares one label
// style — a small icon and an 11px uppercase grey label — and is always open,
// so the pane reads top to bottom as a list of clear sections.

import type { ReactNode } from "react";

/** The one label style every details group uses. */
export const detailsLabel = "text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]";

/**
 * A titled group. `icon` sits before the label; `hint` is one grey line
 * under it saying what the group is for.
 */
export function DetailsSection({ id, title, icon, hint, children }: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `details-${id}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3 id={headingId} className={`m-0 flex items-center gap-1.5 ${hint ? "mb-0.5" : "mb-1.5"} ${detailsLabel}`}>
        {icon && <span aria-hidden className="shrink-0 flex [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>}
        <span className="truncate">{title}</span>
      </h3>
      {hint && <p className="text-[11px] text-ink-400 mb-2">{hint}</p>}
      {children}
    </section>
  );
}

/** Selects and inputs inside the pane: roomy on a phone, compact with a mouse. */
export const detailsControl = "w-full h-11 md:h-auto border border-line rounded-control px-2.5 md:py-1.5 text-base md:text-xs text-ink-900 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60";
/** A small bordered button in the pane. */
export const detailsButton = "inline-flex items-center justify-center gap-1.5 min-h-11 md:min-h-0 px-2.5 md:py-1.5 rounded-control border border-line bg-white text-[13px] md:text-[11px] font-semibold text-ink-600 hover:bg-canvas disabled:opacity-60";
