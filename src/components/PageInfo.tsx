"use client";

// A screen's one-line description, with the longer explanation one tap away.
//
// The title says where you are, the line under it says what it is for, and both
// stay on the page: a screen with no words at all is hard to read cold. Only
// the part that is NOT needed to act — the detail, the rules, the caveats —
// sits behind the small eye, in a popover that opens right at the icon (hover
// or tap), the way the product tour's tips do. No side panel, no empty space.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye } from "lucide-react";

const W = 320;      // popover width
const GAP = 8;      // space between the icon and the popover
const EDGE = 12;    // closest the popover gets to the viewport edge

export function PageInfo({ lead, className = "text-sm text-slate-500", children }: {
  /** The visible one-liner. Leave out to show just the eye (next to a title). */
  lead?: React.ReactNode;
  className?: string;
  /** The detail behind the eye. */
  children?: React.ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(() => { clearTimeout(timer.current); setOpen(true); }, []);
  const hide = useCallback(() => { clearTimeout(timer.current); setOpen(false); setPinned(false); }, []);
  // Hover opens after a beat and closes after one, so passing over the icon on the
  // way elsewhere doesn't flash a card, and moving onto the card doesn't lose it.
  const hoverIn = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 140); };
  const hoverOut = () => { if (pinned) return; clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 160); };

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = card.current?.offsetHeight ?? 120;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - W / 2), window.innerWidth - W - EDGE);
    const up = r.bottom + GAP + h > window.innerHeight - EDGE && r.top - GAP - h > EDGE;
    setPos({ left, top: up ? r.top - GAP - h : r.bottom + GAP, up });
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !btn.current?.contains(t)) hide();
    };
    const onMove = () => hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove);
    };
  }, [open, hide]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const eye = children ? (
    <>
      <button ref={btn} type="button" aria-label="More about this" aria-expanded={open}
        onClick={() => { if (open && pinned) hide(); else { show(); setPinned(true); } }}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut}
        className="inline-flex align-[-3px] ml-1 p-0.5 rounded text-slate-300 transition-[color,transform] duration-200 ease-out hover:text-brand-700 focus-visible:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700 active:scale-90 motion-reduce:transition-none">
        <Eye className="w-3.5 h-3.5" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={card} role="tooltip" onMouseEnter={show} onMouseLeave={hoverOut}
          style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: W, maxWidth: `calc(100vw - ${EDGE * 2}px)`, visibility: pos ? "visible" : "hidden", transformOrigin: pos?.up ? "bottom" : "top" }}
          className="z-50 rounded-card border border-line bg-white p-3.5 text-[13px] leading-relaxed text-slate-600 shadow-xl u-scale-in space-y-2">
          {children}
        </div>, document.body)}
    </>
  ) : null;

  if (lead == null) return eye;
  return <p className={className}>{lead}{eye}</p>;
}
