"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Pointer effects write CSS variables once per animation frame, without React renders.
// The content itself remains server-rendered through the children slot.
export function HomeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let card: HTMLElement | null = null;
    const reset = () => {
      card?.style.removeProperty("--tilt-x");
      card?.style.removeProperty("--tilt-y");
      card?.style.removeProperty("--spot-x");
      card?.style.removeProperty("--spot-y");
      card = null;
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-tilt]")
            : null;
        if (target !== card) {
          reset();
          card = target;
        }
        if (card) {
          const rect = card.getBoundingClientRect();
          const x = Math.max(
            0,
            Math.min(1, (event.clientX - rect.left) / rect.width),
          );
          const y = Math.max(
            0,
            Math.min(1, (event.clientY - rect.top) / rect.height),
          );
          card.style.setProperty("--tilt-x", `${(0.5 - y) * 7}deg`);
          card.style.setProperty("--tilt-y", `${(x - 0.5) * 7}deg`);
          card.style.setProperty("--spot-x", `${x * 100}%`);
          card.style.setProperty("--spot-y", `${y * 100}%`);
        }
        const hero = element.querySelector<HTMLElement>(".marketing-hero");
        if (
          hero &&
          event.target instanceof Node &&
          hero.contains(event.target)
        ) {
          const rect = hero.getBoundingClientRect();
          hero.style.setProperty(
            "--pointer-x",
            `${event.clientX - rect.left}px`,
          );
          hero.style.setProperty(
            "--pointer-y",
            `${event.clientY - rect.top}px`,
          );
        }
      });
    };
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          (entry.target as HTMLElement).dataset.motionActive = String(
            entry.isIntersecting && !document.hidden,
          );
        }),
      { rootMargin: "80px" },
    );
    const regions = element.querySelectorAll<HTMLElement>(
      "[data-motion-region]",
    );
    regions.forEach((region) => observer.observe(region));
    const visibility = () => {
      if (document.hidden)
        regions.forEach((region) => {
          region.dataset.motionActive = "false";
        });
      else {
        regions.forEach((region) => {
          observer.unobserve(region);
          observer.observe(region);
        });
      }
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      reset();
    };
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      reset();
      observer.disconnect();
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <div ref={root} className="marketing-home">
      {children}
    </div>
  );
}
