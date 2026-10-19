"use client";

import { useEffect, useRef } from "react";
import { Compass } from "lucide-react";
import { installProductTour, tourStorageKey } from "@/lib/product-tour";

export function ProductTour({ tenantId, email, activeTab, blocked, impersonating }: {
  tenantId: string; email: string; activeTab: string; blocked: boolean; impersonating: boolean;
}) {
  const start = useRef<() => void>(() => {});
  const storageKey = tourStorageKey(tenantId, email);
  useEffect(() => {
    if (blocked) return;
    const controller = installProductTour({ storageKey, impersonating });
    start.current = controller.start;
    return () => { start.current = () => {}; controller.cleanup(); };
  }, [storageKey, activeTab, blocked, impersonating]);

  return (
    <button type="button" data-tour="replay" disabled={blocked} onClick={() => start.current()}
      aria-label="Take a tour" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700 disabled:opacity-50">
      <Compass className="h-4 w-4" aria-hidden="true" />
      <span>Take a tour</span>
    </button>
  );
}
