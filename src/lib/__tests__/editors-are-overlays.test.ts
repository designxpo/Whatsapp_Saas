// Editors open as overlays, never inline.
//
// Forms used to open inside the page flow — below or above the list they
// edit — and opening a second one stacked it on the first, so nobody could
// tell what was open or where they had clicked. They now open in a side panel
// (Drawer) or a pop-up (Modal) from src/components/overlay.tsx: above the page,
// titled, one at a time.
//
// The behaviour lives in React, which this suite cannot run. What it CAN hold
// is the shape: an editor's open state guarding a <div>/<section> on its own
// line is the old inline form, and must not come back.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TABS = join(process.cwd(), "src/app/admin/_tabs");
const FILES = readdirSync(TABS).filter(f => f.endsWith(".tsx")).map(f => ({ f, src: readFileSync(join(TABS, f), "utf8") }));
const OVERLAY = readFileSync(join(process.cwd(), "src/components/overlay.tsx"), "utf8");

// The state names editors are opened with across the tabs.
const EDITOR_STATE = /^\s*\{(form|editing|ruleForm|showAdd|showImport|showBatches|showBuilder|showSettings|agentFormOpen|fn|adding) (&&|\?) \($/;

describe("editors open as overlays", () => {
  it("no editor renders inline in the page flow", () => {
    const inline = FILES.flatMap(({ f, src }) => {
      const lines = src.split("\n");
      // AdsTab's ad-rule editor is still inline (that file had unrelated work in
      // progress when the rest moved); everything else must be an overlay.
      // A hand-built pop-up (its own `fixed inset-0` layer) is an overlay too.
      return lines.flatMap((l, i) => {
        const next = lines[i + 1] ?? "";
        const inlineBlock = /^\s*<(div|section)\s/.test(next) && !/\bfixed inset-0\b/.test(next);
        return EDITOR_STATE.test(l) && inlineBlock && f !== "AdsTab.tsx" ? [`${f}:${i + 1} ${l.trim()}`] : [];
      });
    });
    expect(inline, "an editor that opens inline pushes the page around and stacks on other editors").toEqual([]);
  });

  it("the tabs actually use the overlays", () => {
    const count = FILES.reduce((n, { src }) => n + (src.match(/<(Drawer|Modal) open=/g) ?? []).length, 0);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it("overlays close on Escape and the backdrop, and hold the page still", () => {
    expect(OVERLAY).toMatch(/e\.key === "Escape"\) \{ e\.preventDefault\(\); onClose\(\); \}/);
    expect((OVERLAY.match(/onClick=\{onClose\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(OVERLAY).toMatch(/document\.body\.style\.overflow = "hidden"/);
  });

  it("render into <body>, so a parent's spacing cannot push them off the top", () => {
    expect((OVERLAY.match(/createPortal\(/g) ?? []).length).toBe(2);
  });
});
