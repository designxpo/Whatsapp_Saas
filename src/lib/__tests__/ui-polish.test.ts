// The portal's shared look and motion, held in place.
//
// What this pins, and why each matters:
//  - Text stays readable: the 400 greys used to sit at 2.5:1 and the brand
//    blue at 3.7:1 — ~1,700 hints, captions and links below the 4.5:1 that
//    small text needs. Computed here from the CSS itself, so a later "lighter
//    grey" or "brighter blue" fails a test.
//  - Overlays leave the way they came, and their open/close effect does not
//    re-run on every render — it did, and pulled the caret back to the first
//    field after each keystroke in any overlay form.
//  - Reduced motion still gives feedback, and spinners keep turning.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CSS = read("src/app/globals.css");
const OVERLAY = read("src/components/overlay.tsx");
const CONFIRM = read("src/components/confirm-dialog.tsx");

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const colorOf = (cls: string) => CSS.match(new RegExp(`\\.${cls} \\{ color: (#[0-9a-fA-F]{6}); \\}`))?.[1] ?? "";

describe("readable muted text", () => {
  for (const cls of ["text-ink-400", "text-slate-400", "text-slate-500"]) {
    it(`${cls} clears 4.5:1 on white cards and on the page background`, () => {
      const c = colorOf(cls);
      expect(c, `${cls} must be set in globals.css`).toMatch(/^#/);
      expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, "#f4f5f7")).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const cls of ["text-brand-700", "text-brand-600"]) {
    it(`${cls} as text clears 4.5:1, on white, the page and its own light chips`, () => {
      const c = colorOf(cls);
      expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, "#f4f5f7")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, "#e9f3ff")).toBeGreaterThanOrEqual(4.5);   // brand-50
    });
  }

  it("keeps a visible step between tertiary and secondary text", () => {
    expect(contrast(colorOf("text-slate-500"), "#ffffff") - contrast(colorOf("text-slate-400"), "#ffffff")).toBeGreaterThan(1.5);
  });
});

describe("overlays", () => {
  it("leave the way they came instead of vanishing", () => {
    expect(OVERLAY).toMatch(/usePresence\(open, DRAWER_EXIT_MS\)/);
    expect(OVERLAY).toMatch(/usePresence\(open, MODAL_EXIT_MS\)/);
    expect(CONFIRM).toMatch(/usePresence\(!!pending, \d+\)/);
    expect(CSS).toMatch(/\.ov-drawer \{ transform: translateX\(100%\)/);
    expect(CSS).toMatch(/\.ov-drawer\[data-shown\] \{ transform: none/);
  });

  it("never re-run their open effect on a re-render — that stole focus mid-typing", () => {
    expect(OVERLAY).toMatch(/\}, \[open, mounted\]\);/);
    expect(OVERLAY).not.toMatch(/\[open, mounted, onClose\]|\[open, onClose\]/);
  });

  it("keep Tab inside and give focus back to what opened them", () => {
    expect(OVERLAY).toMatch(/e\.key !== "Tab"/);
    expect(OVERLAY).toMatch(/restoreTo\.focus\(/);
  });

  it("can be swiped away, finishing on a spring at the swipe's own speed", () => {
    expect(OVERLAY).toMatch(/shouldDismiss\(offset\.current, velocity, width\)/);
    expect(OVERLAY).toMatch(/animateSpring\(offset\.current, close \? width : 0, velocity/);
  });
});

describe("reduced motion", () => {
  const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
  it("removes travel but keeps fades, and keeps loaders turning", () => {
    expect(block).toMatch(/\.animate-spin \{ animation-duration: \.8s !important; animation-iteration-count: infinite !important; \}/);
    expect(block).toMatch(/\.ov-modal \{ opacity: 0; transition: opacity \.16s ease !important; \}/);
  });
});
