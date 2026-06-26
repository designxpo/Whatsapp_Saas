"use client";

import { useEffect, useRef, useState } from "react";

// Fade-and-rise on scroll. Starts hidden, reveals once when it enters the
// viewport. `delay` (ms) staggers siblings. The `data-reveal` attribute lets the
// reduced-motion CSS rule force it visible. Falls back to visible if there's no
// IntersectionObserver support.
export function Reveal({
  children, delay = 0, className = "", as: Tag = "div",
}: { children: React.ReactNode; delay?: number; className?: string; as?: "div" | "section" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Comp = Tag as React.ElementType;
  return (
    <Comp
      ref={ref}
      data-reveal
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"} ${className}`}
    >
      {children}
    </Comp>
  );
}

// Tracks how far `ref` is through the viewport, as p ∈ ~[-1, 1] (−1 below the
// fold, 0 centred, +1 above). `ref` must sit on a NON-transformed element
// (e.g. the section) so the measurement stays stable; apply the resulting
// offset to child layers. Returns 0 forever under prefers-reduced-motion.
export function useParallax(ref: React.RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const next = (vh / 2 - (r.top + r.height / 2)) / (vh / 2 + r.height / 2); // ~ -1..1
      setP(Math.round(next * 1000) / 1000);
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [ref]);
  return p;
}

// Drop-in scroll parallax for DECORATIVE layers. Drifts its children by up to
// `speed` px as the layer crosses the viewport. The outer (tracked) element is
// never transformed — only the inner wrapper moves — so measurement can't feed
// back on itself. Disabled under reduced-motion. Typical use:
//   <Parallax speed={90} className="pointer-events-none absolute inset-0">
//     <div className="absolute -left-16 top-8 h-72 w-72 rounded-full bg-[#7c5cff]/15 blur-3xl" />
//   </Parallax>
export function Parallax({
  speed = 60, className = "", children,
}: { speed?: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useParallax(ref);
  return (
    <div ref={ref} aria-hidden className={className}>
      <div className="relative h-full w-full" style={{ transform: `translate3d(0, ${(p * speed).toFixed(1)}px, 0)`, willChange: "transform" }}>
        {children}
      </div>
    </div>
  );
}
