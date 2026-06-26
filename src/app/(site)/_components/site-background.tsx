"use client";

// Living gradient backdrop for the whole marketing site: soft colour blobs on a
// white base, fixed to the viewport, drifting on scroll (parallax) at different
// rates. Because it sits behind every section, the gradient + parallax effect
// reads site-wide — not just inside one panel. Held still (no transform) under
// prefers-reduced-motion; the colour wash still shows.
//
// Shares the page-wide scroll dispatcher in ./motion (one listener + one rAF for
// the whole site) instead of registering its own scroll listener; under
// reduced-motion the dispatcher reports a constant scrollY of 0, so the blobs
// stay put automatically.
import { useScrollY } from "./motion";

// Alphas tuned so the colour is clearly visible in the gutters yet light enough
// that slate body text over the tint still clears WCAG AA. Cool brand hues
// (blue/violet/sky) anchor; warm hues (mint/amber/rose) stay lower so they don't
// muddy to beige where they overlap.
const BLOBS = [
  { c: "rgba(7,131,253,0.16)",   pos: "left-[-8%] top-[-6%]",  size: "h-[46vh] w-[46vh]", speed: 0.06 },
  { c: "rgba(124,92,255,0.16)",  pos: "right-[-10%] top-[5%]", size: "h-[52vh] w-[52vh]", speed: -0.12 },
  { c: "rgba(52,211,153,0.13)",  pos: "left-[1%] top-[39%]",   size: "h-[44vh] w-[44vh]", speed: 0.15 },
  { c: "rgba(246,178,107,0.12)", pos: "right-[-2%] top-[57%]", size: "h-[48vh] w-[48vh]", speed: -0.08 },
  { c: "rgba(79,139,255,0.15)",  pos: "left-[22%] top-[77%]",  size: "h-[50vh] w-[50vh]", speed: 0.11 },
  { c: "rgba(236,72,153,0.10)",  pos: "right-[16%] top-[93%]", size: "h-[42vh] w-[42vh]", speed: -0.14 },
];

export function SiteBackground() {
  const y = useScrollY(); // shared dispatcher; 0 (held still) under reduced-motion

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-white">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className={`absolute ${b.pos} ${b.size} rounded-full blur-3xl`}
          style={{
            background: `radial-gradient(circle, ${b.c}, transparent 70%)`,
            transform: `translate3d(0, ${(y * b.speed).toFixed(1)}px, 0)`,
          }}
        />
      ))}
    </div>
  );
}
