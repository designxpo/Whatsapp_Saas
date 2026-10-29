// A message's colour comes from the line that knows what happened, never from
// the words in it. Screens used to guess — red unless the text matched
// "Saved.", green unless it contained "fail" — and one kept every message red,
// so "@account is connected and receiving." read as a failure. They now pass a
// tone to useNotice() and render <Notice>. This keeps the guessing from coming
// back.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}
const ADMIN = tsxFiles(join(process.cwd(), "src/app/admin"));

describe("message tone", () => {
  it("no screen picks a message's colour by reading its words", () => {
    const guessing = ADMIN.filter(f => {
      const s = readFileSync(f, "utf8");
      return /\/[^/\n]*(fail|error)[^/\n]*\/i?\.test\((msg|note|result)\)/.test(s) || /(msg|note) === "Saved/.test(s);
    });
    expect(guessing.map(f => f.replace(process.cwd() + "/", ""))).toEqual([]);
  });

  it("no component shows a message it sets as success in fixed red", () => {
    const hits: string[] = [];
    for (const f of ADMIN) {
      const parts = readFileSync(f, "utf8").split(/\n(?=(?:export (?:default )?)?(?:async )?function \w)/);
      for (const part of parts) {
        const redRender = /\{msg && (?:!\w+ && )?<p className="text-xs text-red-500">\{msg\}<\/p>\}/.test(part);
        const bareSuccess = /setMsg\((["`])[^"`]*\b(Saved|Connected|Published|Imported|Added|Created)\b[^"`]*\1\)/.test(part);
        if (redRender && bareSuccess) hits.push(`${f.replace(process.cwd() + "/", "")} › ${part.match(/function (\w+)/)?.[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
