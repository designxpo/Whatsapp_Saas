// Motion that behaves like the physical world: springs, momentum and soft
// edges, for anything a person drags (src/components/overlay.tsx).
//
// From Apple's "Designing Fluid Interfaces" (WWDC 2018), translated for the
// web. A drag must hand its speed to the animation that finishes it, or there
// is a visible seam where the finger lets go; a CSS transition has no way to
// take that speed, a spring does. And a spring starts from wherever the thing
// is NOW, so it can be grabbed again mid-flight and simply follows.
//
// Pure maths plus one requestAnimationFrame loop, rather than a library: the
// portal needs a single spring, and the numbers are Apple's own.

/**
 * A spring in the two numbers designers reason with, not mass/stiffness:
 * `damping` 1 settles without overshoot (the default for UI), below 1 bounces;
 * `response` is roughly how long it takes to get there, in seconds.
 */
export interface SpringSpec { damping: number; response: number }

export const SPRINGS = {
  /** Most UI: arrives without overshoot. */
  settle: { damping: 1, response: 0.35 },
  /**
   * A side panel let go of. Critically damped on purpose: an overshoot on the
   * way back would swing it past its edge and open a gap beside the window.
   */
  sheet: { damping: 1, response: 0.32 },
} satisfies Record<string, SpringSpec>;

/** Stiffness and friction (mass 1) for a spring given as damping + response. */
export function springConstants({ damping, response }: SpringSpec): { stiffness: number; friction: number } {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, friction: 2 * damping * omega };
}

/**
 * One step of the spring: where it is and how fast, `dt` seconds later.
 * Semi-implicit Euler in small sub-steps, which stays stable at any frame rate.
 */
export function stepSpring(x: number, v: number, target: number, dt: number, spec: SpringSpec): { x: number; v: number } {
  const { stiffness, friction } = springConstants(spec);
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (-stiffness * (x - target) - friction * v) * h;
    x += v * h;
  }
  return { x, v };
}

/**
 * Where a flick would come to rest: Apple's projection, the same exponential
 * deceleration as scrolling (`decelerationRate` 0.998 is UIScrollView's
 * normal rate). Not v²/2a — that is the textbook answer, not the shipped one.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Resistance past an edge: the further it is pulled, the less it follows —
 * never a hard stop, which reads as frozen.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const o = Math.abs(overshoot);
  return sign * ((o * dimension * constant) / (dimension + constant * o));
}

/**
 * After a drag toward closing: close, or settle back open? Decided by where
 * the motion was GOING (the projected rest point), so a quick flick closes
 * from anywhere and a slow drag past halfway does too.
 */
export function shouldDismiss(offset: number, velocity: number, size: number): boolean {
  return offset + project(velocity) > size / 2;
}

/** Speed in px/s from the last few pointer samples (the last ~80ms only). */
export function releaseVelocity(samples: { t: number; x: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const recent = samples.filter(s => last.t - s.t <= 80);
  const first = recent.length >= 2 ? recent[0] : samples[samples.length - 2];
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Animate a value to `to` on a spring, starting at `from` with `velocity`
 * (px/s) — the drag's own speed, so there is no seam. `onFrame` gets each
 * value; returns a function that stops it where it is (to be grabbed again).
 * With reduced motion it jumps straight to the end.
 */
export function animateSpring(
  from: number, to: number, velocity: number,
  onFrame: (x: number) => void, spec: SpringSpec = SPRINGS.settle, onDone?: () => void,
): () => void {
  if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
    onFrame(to); onDone?.();
    return () => {};
  }
  let x = from, v = velocity, last = 0, raf = 0, stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    ({ x, v } = stepSpring(x, v, to, dt, spec));
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 5) { onFrame(to); onDone?.(); return; }
    onFrame(x);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
