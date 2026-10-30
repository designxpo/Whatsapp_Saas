// The owner console moves and behaves like the rest of the portal (Apple HIG +
// "Designing Fluid Interfaces"). Before this it had its own older copies: side
// panels and dialogs that vanished in one frame, no focus handling, a nav
// highlight that jumped, rows only a mouse could open, and lone spinners in
// empty space while loading. Source-level where the behaviour lives in JSX, as
// ui-polish.test.ts does for the shared overlays themselves.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openRow } from "../../app/admin/owner/_row";

const ROOT = join(process.cwd(), "src/app/admin/owner");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const UI = read("_ui.tsx");
const SHELL = read("_shell.tsx");
const OVERLAY = readFileSync(join(process.cwd(), "src/components/overlay.tsx"), "utf8");
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
});
const ALL = files(ROOT).map(p => ({ p: p.slice(ROOT.length + 1), src: readFileSync(p, "utf8") }));

describe("owner console overlays", () => {
  it("side panels and confirmations are the portal's shared ones, which leave the way they came", () => {
    expect(UI).toMatch(/import \{ Drawer as Sheet, Modal \} from "@\/components\/overlay"/);
    expect(UI).toMatch(/<Sheet open=\{open && !leaving\} onClose=\{leave\}/);
    expect(UI).toMatch(/<Modal open=\{!leaving\} onClose=\{cancel\}/);
  });
  it("no owner screen keeps a one-way, keyframe-only overlay of its own", () => {
    for (const f of ALL) expect(f.src, f.p).not.toMatch(/u-slide-in-right|u-scale-in|u-fade-in/);
  });
  it("the tenant search rises in and sinks back out, and is announced as a search with results", () => {
    expect(SHELL).toMatch(/usePresence\(open, PALETTE_EXIT_MS\)/);
    expect(SHELL).toMatch(/role="combobox"[\s\S]*aria-activedescendant/);
    expect(SHELL).toMatch(/role="option" aria-selected=\{i === sel\}/);
  });
  it("only the topmost overlay answers Escape — one Escape used to close a dialog and the panel under it", () => {
    expect(OVERLAY).toMatch(/if \(openStack\[openStack\.length - 1\] !== me \|\| e\.defaultPrevented\) return;/);
  });
});

describe("owner console navigation", () => {
  it("the active highlight glides between sections, in a column or a row", () => {
    expect(SHELL).toMatch(/useSlidingPill\(navList, activeHref, \[\], "xy"\)/);
    expect(SHELL).toMatch(/aria-current=\{active \? "page" : undefined\}/);
  });
  it("keeps every function on a phone — App dashboard, System setup and Log out were hidden below md", () => {
    expect(SHELL).not.toMatch(/hidden md:flex flex-col gap-1 mt-4/);
  });
});

describe("rows that open a panel", () => {
  it("every one is opened through openRow, so the keyboard can open it too", () => {
    for (const f of ALL) expect(f.src, f.p).not.toMatch(/<tr [^>]*onClick=/);
  });
  const key = (k: string, onRow = true) => {
    const row = {};
    return { key: k, target: onRow ? row : {}, currentTarget: row, preventDefault: vi.fn() } as never;
  };
  it("Enter and Space on the row open it", () => {
    const open = vi.fn();
    const r = openRow(open);
    expect(r.tabIndex).toBe(0);
    r.onKeyDown(key("Enter")); r.onKeyDown(key(" "));
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("a key press inside the row stays with its own control (the selection checkbox)", () => {
    const open = vi.fn();
    openRow(open).onKeyDown(key(" ", false));
    openRow(open).onKeyDown(key("a"));
    expect(open).not.toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("shows the shape of the content, not a lone spinner in empty space", () => {
    for (const f of ALL) {
      expect(f.src, f.p).not.toMatch(/<div className="flex justify-center py-1\d"><Spinner \/><\/div>/);
      expect(f.src, f.p).not.toMatch(/return <Spinner \/>;/);
    }
  });
});
