"use client";

import { useCallback, useEffect, useRef } from "react";
import { Compass } from "lucide-react";
import { installProductTour, tourStorageKey } from "@/lib/product-tour";

/** Wide enough for the sidebar the tour walks through (Tailwind's lg). */
export const TOUR_AUTO_START_QUERY = "(min-width: 1024px)";

export interface TourOptions { tenantId: string; email: string; activeTab: string; blocked: boolean; impersonating: boolean }

/**
 * The tour's controller, installed once by the shell. Returns `start` for any
 * number of "Take a tour" buttons (the header on a computer, the menu on a
 * phone). It only opens by itself on a first visit at desktop width: on a
 * phone the menu it explains is folded away.
 */
export function useProductTour({ tenantId, email, activeTab, blocked, impersonating }: TourOptions): () => void {
  const start = useRef<() => void>(() => {});
  const storageKey = tourStorageKey(tenantId, email);
  useEffect(() => {
    if (blocked) return;
    const controller = installProductTour({
      storageKey, impersonating,
      autoStart: () => typeof window.matchMedia !== "function" || window.matchMedia(TOUR_AUTO_START_QUERY).matches,
    });
    start.current = controller.start;
    return () => { start.current = () => {}; controller.cleanup(); };
  }, [storageKey, activeTab, blocked, impersonating]);
  return useCallback(() => start.current(), []);
}

/** The "Take a tour" button. `onStart` lets the phone menu close itself first. */
export function TourButton({ onStart, blocked, className = "" }: { onStart: () => void; blocked: boolean; className?: string }) {
  return (
    <button type="button" data-tour="replay" disabled={blocked} onClick={onStart}
      data-help-disabled="Available again once your plan is active."
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-white px-3 text-xs lg:text-[13px] font-semibold text-ink-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700 disabled:opacity-50 ${className}`}>
      <Compass className="h-4 w-4" aria-hidden="true" />
      <span>Take a tour</span>
    </button>
  );
}

/** The original all-in-one: controller plus one button. */
export function ProductTour(props: TourOptions) {
  const start = useProductTour(props);
  return <TourButton onStart={start} blocked={props.blocked} />;
}
