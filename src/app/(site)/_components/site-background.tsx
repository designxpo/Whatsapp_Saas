"use client";

// Living gradient backdrop for the whole marketing site: soft colour blobs on a
// white base, fixed to the viewport, drifting on scroll (parallax) at different
// rates. Because it sits behind every section, the gradient + parallax effect
// reads site-wide — not just inside one panel. Held still (no transform) under
// prefers-reduced-motion; the colour wash still shows.
import { useEffect, useState } from "react";

const BLOBS = [
  { c: "rgba(7,131,253,0.13)",   pos: "left-[-8%] top-[-6%]",  size: "h-[46vh] w-[46vh]", speed: 0.06 },
  { c: "rgba(124,92,255,0.13)",  pos: "right-[-10%] top-[5%]", size: "h-[52vh] w-[52vh]", speed: -0.12 },
  { c: "rgba(52,211,153,0.12)",  pos: "left-[1%] top-[39%]",   size: "h-[44vh] w-[44vh]", speed: 0.15 },
  { c: "rgba(246,178,107,0.11)", pos: "right-[-2%] top-[57%]", size: "h-[48vh] w-[48vh]", speed: -0.08 },
  { c: "rgba(79,139,255,0.12)",  pos: "left-[22%] top-[77%]",  size: "h-[50vh] w-[50vh]", speed: 0.11 },
  { c: "rgba(236,72,153,0.09)",  pos: "right-[16%] top-[93%]", size: "h-[42vh] w-[42vh]", speed: -0.14 },
];

export function SiteBackground() {
  const [y, setY] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setY(window.scrollY)); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", onScroll); };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-white">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className={`absolute ${b.pos} ${b.size} rounded-full blur-3xl`}
          style={{
            background: `radial-gradient(circle, ${b.c}, transparent 70%)`,
            transform: `translate3d(0, ${(y * b.speed).toFixed(1)}px, 0)`,
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
