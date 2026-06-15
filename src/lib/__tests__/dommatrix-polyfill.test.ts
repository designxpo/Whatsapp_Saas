import { describe, it, expect } from "vitest";
import { DOMMatrixPolyfill } from "@/lib/dommatrix-polyfill";

const approx = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("DOMMatrixPolyfill", () => {
  it("defaults to identity", () => {
    const m = new DOMMatrixPolyfill();
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([1, 0, 0, 1, 0, 0]);
    expect(m.isIdentity).toBe(true);
    expect(m.is2D).toBe(true);
  });

  it("constructs from a 6-element array", () => {
    const m = new DOMMatrixPolyfill([2, 0, 0, 3, 10, 20]);
    expect([m.a, m.d, m.e, m.f]).toEqual([2, 3, 10, 20]);
  });

  it("constructs from a 16-element (4x4) array taking the 2-D subset", () => {
    const m = new DOMMatrixPolyfill([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1]);
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([2, 0, 0, 3, 10, 20]);
  });

  it("transformPoint applies a*x + c*y + e (and b/d/f)", () => {
    const m = new DOMMatrixPolyfill([2, 0, 0, 3, 10, 20]);
    const p = m.transformPoint({ x: 5, y: 7 });
    approx(p.x, 2 * 5 + 10);
    approx(p.y, 3 * 7 + 20);
  });

  it("multiply composes transforms (other applied first)", () => {
    const scale = new DOMMatrixPolyfill([2, 0, 0, 2, 0, 0]);
    const translate = new DOMMatrixPolyfill([1, 0, 0, 1, 5, 5]);
    // scale × translate: point is translated, then scaled
    const p = scale.multiply(translate).transformPoint({ x: 1, y: 1 });
    approx(p.x, (1 + 5) * 2);
    approx(p.y, (1 + 5) * 2);
  });

  it("inverse round-trips a point", () => {
    const m = new DOMMatrixPolyfill([2, 0, 0, 3, 10, 20]);
    const inv = m.inverse();
    const original = { x: 4, y: 9 };
    const back = inv.transformPoint(m.transformPoint(original));
    approx(back.x, original.x);
    approx(back.y, original.y);
  });

  it("translate/scale return new matrices (non-mutating)", () => {
    const m = new DOMMatrixPolyfill();
    const t = m.translate(3, 4);
    expect(m.isIdentity).toBe(true);          // original unchanged
    expect([t.e, t.f]).toEqual([3, 4]);
  });

  it("preMultiplySelf and multiplySelf mutate in place", () => {
    const m = new DOMMatrixPolyfill([1, 0, 0, 1, 1, 1]);
    m.multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, 2, 3]));
    expect([m.e, m.f]).toEqual([3, 4]);
  });
});
