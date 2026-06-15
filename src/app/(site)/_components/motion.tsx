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
