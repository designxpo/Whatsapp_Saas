// The physics behind swiping a side panel away (src/lib/motion.ts): springs
// in Apple's damping/response terms, the projection Apple ships for flicks,
// and resistance at an edge. Each is checked against what it is for.
import { describe, it, expect } from "vitest";
import { springConstants, stepSpring, project, rubberband, shouldDismiss, releaseVelocity, animateSpring, SPRINGS } from "../motion";

/** Run a spring to rest, returning every position it passed through. */
function run(from: number, to: number, v: number, spec = SPRINGS.settle, seconds = 2) {
  const path: number[] = [];
  let x = from, vel = v;
  for (let t = 0; t < seconds; t += 1 / 60) {
    ({ x, v: vel } = stepSpring(x, vel, to, 1 / 60, spec));
    path.push(x);
  }
  return path;
}

describe("springs", () => {
  it("map Apple's damping and response onto stiffness and friction", () => {
    const { stiffness, friction } = springConstants({ damping: 1, response: 0.35 });
    expect(stiffness).toBeCloseTo((2 * Math.PI / 0.35) ** 2, 6);
    expect(friction).toBeCloseTo(2 * (2 * Math.PI / 0.35), 6);
  });

  it("critically damped: arrives without overshooting — a panel never swings past its edge", () => {
    const path = run(400, 0, 0, SPRINGS.sheet);
    expect(Math.min(...path)).toBeGreaterThanOrEqual(-0.01);
    expect(Math.abs(path[path.length - 1])).toBeLessThan(0.5);
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeLessThanOrEqual(path[i - 1] + 1e-9);
  });

  it("settles in about its response time, not an arbitrary duration", () => {
    const path = run(100, 0, 0, { damping: 1, response: 0.3 });
    const settledAt = path.findIndex(x => Math.abs(x) < 1) / 60;
    expect(settledAt).toBeGreaterThan(0.2);
    expect(settledAt).toBeLessThan(0.7);
  });

  it("below damping 1 it bounces", () => {
    expect(Math.min(...run(100, 0, 0, { damping: 0.5, response: 0.35 }))).toBeLessThan(-5);
  });

  it("continues at the speed it was let go — no seam between finger and animation", () => {
    // Released moving AWAY from the target at 2000px/s: it first keeps going
    // that way, then turns back, exactly as a thrown object would.
    const path = run(100, 0, 2000, SPRINGS.sheet);
    expect(path[0]).toBeGreaterThan(100);
    expect(Math.abs(path[path.length - 1])).toBeLessThan(0.5);
  });

  it("is stable however long a frame takes", () => {
    let x = 300, v = 0;
    ({ x, v } = stepSpring(x, v, 0, 0.25, SPRINGS.settle));   // a stalled tab
    expect(Number.isFinite(x) && Number.isFinite(v)).toBe(true);
    expect(Math.abs(x)).toBeLessThan(300);
  });

  it("jumps straight to the end where there is no animation frame (or reduced motion)", () => {
    const seen: number[] = [];
    let done = false;
    animateSpring(0, 620, 0, x => seen.push(x), SPRINGS.sheet, () => { done = true; });
    expect(seen).toEqual([620]);
    expect(done).toBe(true);
  });
});

describe("flicks and edges", () => {
  it("projects a flick the way scrolling decelerates (Apple's rate 0.998)", () => {
    expect(project(1000)).toBeCloseTo(499, 6);
    expect(project(-500)).toBeCloseTo(-249.5, 6);
    expect(project(1000, 0.99)).toBeCloseTo(99, 6);   // the snappier rate
  });

  it("resists past an edge progressively, and never stops dead", () => {
    expect(rubberband(10, 600)).toBeCloseTo(5.45, 2);          // ~0.55× near the edge
    expect(rubberband(-10, 600)).toBeCloseTo(-5.45, 2);        // either direction
    expect(rubberband(1e6, 600)).toBeLessThan(600);            // never past the dimension itself
    expect(rubberband(2000, 600)).toBeGreaterThan(rubberband(1000, 600));   // but still moving
  });

  it("closes where the swipe was heading, not just where it stopped", () => {
    const w = 620;
    expect(shouldDismiss(400, 0, w)).toBe(true);       // dragged most of the way, let go
    expect(shouldDismiss(200, 0, w)).toBe(false);      // a nudge settles back
    expect(shouldDismiss(80, 900, w)).toBe(true);      // a quick flick closes from anywhere
    expect(shouldDismiss(400, -900, w)).toBe(false);   // pulled back in: stays open
  });

  it("reads the release speed from the last moments of the drag", () => {
    const samples = Array.from({ length: 8 }, (_, i) => ({ t: i * 16, x: i * 10 }));
    expect(releaseVelocity(samples)).toBeCloseTo(625, 0);
    // A pause before letting go is a slow release, whatever came before it.
    expect(releaseVelocity([{ t: 0, x: 0 }, { t: 16, x: 200 }, { t: 300, x: 201 }])).toBeLessThan(10);
    expect(releaseVelocity([{ t: 0, x: 0 }])).toBe(0);
  });
});
