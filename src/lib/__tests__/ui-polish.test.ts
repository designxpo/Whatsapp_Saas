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

// The ink scale used to stop at 400/600/900/950, so ~240 text-ink-300/500/700/
// 800 classes generated no CSS at all and silently fell back to the body grey.
const TW = read("tailwind.config.ts");
const inkHex = (n: number) => TW.match(new RegExp(`ink: \\{[^}]*?\\b${n}: "(#[0-9A-Fa-f]{6})"`))?.[1] ?? "";

describe("the full ink scale exists and reads", () => {
  for (const n of [300, 500, 700, 800]) {
    it(`ink-${n} is defined in tailwind.config.ts`, () => {
      expect(inkHex(n), `ink-${n} missing — text-ink-${n} would generate nothing`).toMatch(/^#/);
    });
  }

  for (const n of [700, 800]) {
    it(`text-ink-${n} clears 4.5:1 on white and the page as it is`, () => {
      expect(contrast(inkHex(n), "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(inkHex(n), "#f4f5f7")).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const cls of ["text-ink-300", "text-ink-500"]) {
    it(`${cls} is retuned as text and clears 4.5:1 on white and the page`, () => {
      const c = colorOf(cls);
      expect(c, `${cls} must be set in globals.css`).toMatch(/^#/);
      expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, "#f4f5f7")).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("ink-500 text reads darker than ink-400 text, not lighter", () => {
    expect(contrast(colorOf("text-ink-500"), "#ffffff")).toBeGreaterThan(contrast(colorOf("text-ink-400"), "#ffffff"));
  });
});

describe("placeholders read too", () => {
  // Tailwind emits placeholder: variants after globals.css, so the override
  // needs the element type in front to win; check the selector shape as well.
  const placeholderColor = (cls: string) =>
    CSS.match(new RegExp(`:is\\(input, textarea\\)\\.placeholder\\\\:${cls}::placeholder[^{]*\\{ color: (#[0-9a-fA-F]{6}); \\}`))?.[1] ?? "";

  for (const cls of ["text-ink-400", "text-slate-400"]) {
    it(`placeholder:${cls} is overridden and clears 4.5:1 on a white field`, () => {
      const c = placeholderColor(cls);
      expect(c, `placeholder:${cls} override missing from globals.css`).toMatch(/^#/);
      expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("placeholder:text-ink-300 shares the ink-400 override", () => {
    expect(CSS).toMatch(/:is\(input, textarea\)\.placeholder\\:text-ink-300::placeholder,/);
  });
});

// Status colours that failed 4.5:1 as small text (red-400 2.8:1, amber-600
// 3.2:1, slate-300 1.5:1) were moved to passing shades in these files. Icons
// are held to 3:1 instead, so a lucide icon (a capitalised tag) may keep
// amber-600; an HTML element carrying text may not.
const FIXED = [
  "src/app/admin/_shared.tsx",
  "src/app/admin/page.tsx",
  "src/app/admin/_tabs/BroadcastTab.tsx",
  "src/app/admin/_tabs/TemplatesTab.tsx",
  "src/app/admin/_tabs/InstagramTab.tsx",
  "src/app/admin/_tabs/YoutubeTab.tsx",
  "src/app/admin/_tabs/SequencesTab.tsx",
  "src/app/admin/_tabs/CatalogTab.tsx",
  "src/app/admin/_tabs/GrowthTab.tsx",
  "src/app/admin/_tabs/FormsTab.tsx",
  "src/app/admin/_tabs/AiAdBuilder.tsx",
  "src/app/admin/_tabs/AnalyticsTab.tsx",
  "src/app/admin/_tabs/TeamProgressTab.tsx",
  "src/app/admin/_tabs/HandleHubTab.tsx",
  "src/app/admin/_tabs/OptoutsTab.tsx",
  "src/app/admin/_tabs/IntegrationsTab.tsx",
  "src/app/admin/_tabs/FlowsTab.tsx",
  "src/app/admin/_tabs/AssistantTab.tsx",
  "src/app/admin/_tabs/ReviewsTab.tsx",
  "src/app/admin/owner/_ui.tsx",
  "src/app/admin/owner/page.tsx",
  "src/app/admin/setup/page.tsx",
  "src/app/admin/flows/[id]/page.tsx",
];
// A bare utility (no hover:/placeholder: prefix, no /opacity suffix).
const bare = (cls: string) => new RegExp(`(?<=[\\s"'\`{(])${cls}(?![\\w/-])`, "g");
// The JSX tag a class sits on: the nearest "<Tag" before it.
const tagBefore = (src: string, at: number) => [...src.slice(Math.max(0, at - 1500), at).matchAll(/<([A-Za-z][\w.]*)/g)].pop()?.[1] ?? "";

describe("failing status colours stay out of the fixed files", () => {
  for (const f of FIXED) {
    const src = read(f);
    it(`${f}: no text-red-400`, () => {
      expect(src.match(bare("text-red-400")) ?? []).toEqual([]);
    });
    it(`${f}: text-amber-600 only on icons`, () => {
      const onText = [...src.matchAll(bare("text-amber-600"))]
        .filter(m => /^[a-z]/.test(tagBefore(src, m.index!)))
        .map(m => `line ${src.slice(0, m.index).split("\n").length}`);
      expect(onText).toEqual([]);
    });
    it(`${f}: no text-slate-300 on an element that holds text`, () => {
      // className="… text-slate-300 …">10:30  — the element starts with words.
      const onText = src.match(/className="[^"]*\btext-slate-300\b[^"]*">\s*[^\s<{]/g) ?? [];
      expect(onText).toEqual([]);
    });
  }
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
