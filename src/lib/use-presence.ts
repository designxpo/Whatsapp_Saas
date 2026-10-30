"use client";

// Keep an overlay on screen while it animates away.
//
// Without this an overlay was simply removed when closed: it arrived with a
// slide and vanished in one frame, the way nothing in the physical world
// leaves. `mounted` stays true until the exit has played; `shown` drives the
// CSS (data-shown), and because the motion is a CSS transition rather than a
// keyframe animation, reopening mid-exit reverses from wherever it is instead
// of finishing the exit first.
//
// The way in needs a "from": the closed state has to have been computed
// before the open one is applied, or the overlay just appears. That is done by
// reading layout once, then applying `shown` before paint — deterministic,
// rather than waiting two animation frames, which an idle or background tab
// may not produce.

import { useEffect, useLayoutEffect, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function usePresence(open: boolean, exitMs: number): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) { setMounted(true); return; }
    setShown(false);
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  useIsoLayoutEffect(() => {
    if (!open || !mounted || shown) return;
    void document.body.offsetHeight;   // the closed state, computed: the transition's "from"
    setShown(true);
  }, [open, mounted, shown]);

  return { mounted, shown };
}
