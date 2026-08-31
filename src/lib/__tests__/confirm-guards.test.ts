// Every consequential action in the portal must go through the shared
// confirmation dialog.
//
// A static check rather than a rendering one, deliberately. The failure being
// guarded is not a dialog behaving badly — it is a dialog that isn't there, or
// one that is there but never actually blocks. Component tests cover the dialog
// that exists; this covers the one that is missing.
//
// It catches the three ways this pattern breaks silently on reintroduction:
//
//   • window.confirm() creeping back in — a different look on every OS, unable
//     to show WHAT is about to happen, so read by nobody.
//   • ask({...}) written without `await`. That returns a Promise, which is
//     always truthy, so `if (!(ask({...}))) return;` never returns and the guard
//     is decoration. Type-checking does not catch it: the condition is legal.
//   • A page that renders confirmations without a ConfirmProvider above it.
//     useConfirm() falls back to window.confirm there — on purpose, so an
//     isolated component still asks — which means a missing provider degrades
//     quietly instead of failing.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TABS = join(ROOT, "src/app/admin/_tabs");

const tabFiles = readdirSync(TABS).filter(f => f.endsWith(".tsx")).map(f => join(TABS, f));
const pages = [
  join(ROOT, "src/app/admin/page.tsx"),
  join(ROOT, "src/app/crm/broadcast/page.tsx"),
];
const all = [...tabFiles, ...pages];

const read = (p: string) => readFileSync(p, "utf8");
// Strip line comments so prose mentioning confirm() cannot fail a test.
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "");
const rel = (p: string) => p.slice(ROOT.length + 1);

describe("portal confirmation guards", () => {
  it("routes every confirmation through the shared dialog, never window.confirm", () => {
    const offenders = all
      .filter(p => (code(p).match(/(?<![A-Za-z.])confirm\s*\(/g) ?? []).length > 0)
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("awaits every dialog call", () => {
    let total = 0;
    const offenders: string[] = [];
    for (const p of all) {
      const c = code(p);
      const calls = (c.match(/\bask(?:Confirm)?\(\{/g) ?? []).length;
      const awaited = (c.match(/await\s+ask(?:Confirm)?\(\{/g) ?? []).length;
      total += calls;
      if (calls !== awaited) offenders.push(`${rel(p)} (${calls - awaited} un-awaited)`);
    }
    expect(offenders).toEqual([]);
    expect(total).toBeGreaterThan(30);   // the guards exist at all
  });

  it("guards the broadcast send, the action with the widest blast radius", () => {
    const src = read(join(TABS, "BroadcastTab.tsx"));
    const fn = src.slice(src.indexOf("  async function send() {"));
    expect(fn.startsWith("  async function send() {")).toBe(true);
    const body = fn.slice(0, fn.indexOf("\n  }\n"));

    expect(body).toContain("await askConfirm({");
    // Typed confirmation, because a single click is what went wrong.
    expect(body).toContain('typeToConfirm: "SEND"');
    // And the facts that make the dialog worth reading. The sending number is
    // the one that matters: templates are WABA-scoped, so the wrong number
    // fails on every recipient at once.
    for (const fact of ["Sending to", "Template", "From"]) {
      expect(body).toContain(fact);
    }
    // The guard must come BEFORE the request, not alongside it.
    expect(body.indexOf("await askConfirm({")).toBeLessThan(body.indexOf("/api/admin/broadcast"));
  });

  it("also guards the CRM-side broadcast, which sends just as really", () => {
    const src = read(join(ROOT, "src/app/crm/broadcast/page.tsx"));
    expect(src).toContain("await ask({");
    expect(src).toContain('typeToConfirm: "SEND"');
  });

  it("mounts a provider on every page that shows a dialog", () => {
    // The tabs all render inside src/app/admin/page.tsx; /crm/broadcast is its
    // own route and needs its own provider, which is exactly what was missed
    // when this was first wired up.
    for (const p of pages) {
      expect(read(p)).toContain("<ConfirmProvider>");
    }
  });
});
