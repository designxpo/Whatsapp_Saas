// Minimal, dependency-free DOMMatrix polyfill for server-side PDF text
// extraction. pdfjs-dist (used by pdf-parse) references the browser `DOMMatrix`
// global unguarded; in Node it's undefined, so some PDFs fail with
// "DOMMatrix is not defined". PDFs are 2-D, so a correct 2-D affine matrix
//   | a c e |
//   | b d f |
//   | 0 0 1 |
// covers every operation pdfjs performs during text extraction. Importing this
// module installs the global once (no-op if a real DOMMatrix already exists).

export class DOMMatrixPolyfill {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(init?: number[] | DOMMatrixPolyfill | string) {
    if (!init) return;
    if (typeof init === "string") return;                 // pdfjs never passes strings
    if (Array.isArray(init)) {
      if (init.length === 6) { [this.a, this.b, this.c, this.d, this.e, this.f] = init; }
      else if (init.length === 16) {                       // 4x4 → 2-D subset
        this.a = init[0]; this.b = init[1]; this.c = init[4];
        this.d = init[5]; this.e = init[12]; this.f = init[13];
      }
      return;
    }
    this.a = init.a; this.b = init.b; this.c = init.c;
    this.d = init.d; this.e = init.e; this.f = init.f;
  }

  // 2-D affine accessors pdfjs may read.
  get m11() { return this.a; } get m12() { return this.b; }
  get m21() { return this.c; } get m22() { return this.d; }
  get m41() { return this.e; } get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }

  // this × other (other applied first when transforming a point).
  multiply(o: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    ]);
  }
  private set(m: DOMMatrixPolyfill): this {
    this.a = m.a; this.b = m.b; this.c = m.c; this.d = m.d; this.e = m.e; this.f = m.f; return this;
  }
  multiplySelf(o: DOMMatrixPolyfill): this { return this.set(this.multiply(o)); }
  preMultiplySelf(o: DOMMatrixPolyfill): this { return this.set(o.multiply(this)); }

  translate(tx = 0, ty = 0): DOMMatrixPolyfill {
    return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]));
  }
  translateSelf(tx = 0, ty = 0): this { return this.set(this.translate(tx, ty)); }

  scale(sx = 1, sy?: number): DOMMatrixPolyfill {
    return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy ?? sx, 0, 0]));
  }
  scaleSelf(sx = 1, sy?: number): this { return this.set(this.scale(sx, sy)); }

  inverse(): DOMMatrixPolyfill {
    const det = this.a * this.d - this.b * this.c;
    if (!det || !Number.isFinite(det)) return new DOMMatrixPolyfill([NaN, NaN, NaN, NaN, NaN, NaN]);
    return new DOMMatrixPolyfill([
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    ]);
  }
  invertSelf(): this { return this.set(this.inverse()); }

  transformPoint(p: { x?: number; y?: number } = {}): { x: number; y: number; z: number; w: number } {
    const x = p.x ?? 0, y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }
}

// Install once. Exported for the unit test; also runs on import for side effect.
export function installDomMatrixPolyfill(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = DOMMatrixPolyfill;
}

installDomMatrixPolyfill();
