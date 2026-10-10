"use client";

// Help on dwell: linger on something for a few seconds and Talko explains it.
//
// Why this replaces the native title= rather than joining it: the browser
// tooltip fires at roughly a second, so leaving both in place means a hovering
// user is told the same thing twice, in two styles, three seconds apart. The
// hint text is unchanged — this is a different way of showing the same string,
// not a second copy to keep in sync.
//
// The delay is the whole idea. A tooltip answers "what is this" for everyone,
// constantly, and becomes wallpaper. Three seconds of stillness is a decent
// proxy for "I am actually unsure", so the help arrives for the person who
// wants it and never interrupts the person who doesn't.

import { useEffect, useId, useRef, useState } from "react";
import { Mascot } from "./Mascot";

/** Tunable in one place. Long on purpose — see the note above. */
const DWELL_MS = 3000;

export function MascotHint({
  text, children, side = "right", className = "",
}: { text: string; children: React.ReactNode; side?: "right" | "left"; className?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const arm = () => { cancel(); timer.current = setTimeout(() => setOpen(true), DWELL_MS); };
  const close = () => { cancel(); setOpen(false); };

  // A timer that outlives its component sets state on an unmounted tree.
  useEffect(() => cancel, []);

  return (
    <div
      className={`relative ${className}`}
      onMouseEnter={arm}
      onMouseLeave={close}
      // Keyboard users dwell too, and hover-only help is invisible to them.
      // Same delay, so tabbing quickly through the nav never fires it.
      onFocusCapture={arm}
      onBlurCapture={close}
    >
      {/* Always in the accessibility tree, regardless of the visual state:
          a screen reader should not have to wait three seconds for a
          description it can read instantly. */}
      <span id={id} className="sr-only">{text}</span>
      <div aria-describedby={id}>{children}</div>

      {open && (
        <div
          role="tooltip"
          className={`absolute top-1/2 z-50 -translate-y-1/2 ${side === "right" ? "left-full ml-3" : "right-full mr-3"} w-60 animate-flowin`}
        >
          <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-white p-3 shadow-[0_12px_32px_-12px_rgba(10,26,47,0.28)]">
            <Mascot mood="thinking" size={34} className="shrink-0" />
            <p className="pt-0.5 text-[12px] leading-relaxed text-ink-600">{text}</p>
          </div>
        </div>
      )}
    </div>
  );
}
