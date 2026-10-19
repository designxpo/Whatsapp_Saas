import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeRuns, starvedStages, STALE_MIN } from "../cronstages";

const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 12, 0) + min * 60_000);

describe("cron stage starvation", () => {
  it("a stage that keeps getting its turn is never starved", () => {
    let rec = mergeRuns(null, ["ytcomments", "sequences"], at(0));
    for (let m = 5; m <= 120; m += 5) rec = mergeRuns(rec, ["ytcomments", "sequences"], at(m));
    expect(starvedStages(rec, ["ytcomments", "sequences"], at(121))).toEqual([]);
  });

  it("flags a stage the deadline keeps skipping, while others run", () => {
    let rec = mergeRuns(null, ["sequences", "ytcomments"], at(0));
    for (let m = 5; m <= 60; m += 5) rec = mergeRuns(rec, ["sequences"], at(m));   // yt skipped every tick
    expect(starvedStages(rec, ["sequences", "ytcomments"], at(60))).toEqual([{ stage: "ytcomments", minutes: 60 }]);
  });

  it("flags a stage starved from the very first tick after a deploy", () => {
    let rec = mergeRuns(null, ["sequences"], at(0));
    rec = mergeRuns(rec, ["sequences"], at(STALE_MIN));
    expect(starvedStages(rec, ["sequences", "googlereviews"], at(STALE_MIN))).toEqual([{ stage: "googlereviews", minutes: STALE_MIN }]);
  });

  it("does not flag anything before it has had STALE_MIN to run", () => {
    const rec = mergeRuns(null, [], at(0));
    expect(starvedStages(rec, ["ytcomments"], at(STALE_MIN - 1))).toEqual([]);
  });
});

// Guards on the engine route itself — the mistakes that caused the 2026-10-18
// outage are easy to make again and invisible until a customer notices.
describe("process-queue route", () => {
  const src = readFileSync(join(__dirname, "../../app/api/cron/process-queue/route.ts"), "utf8");
  const code = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  it("never walks every tenant inside the shared deadline", () => {
    // One serial round trip per tenant per tick is what starved every later stage.
    // Read the opted-in tenants instead (tenantIdsWithSetting).
    expect(code).not.toMatch(/from\(\s*["']tenants["']\s*\)/);
  });

  it("runs every stage through stage(), so a skipped stage is noticed", () => {
    // A raw `if (Date.now() - startedAt < DEADLINE)` block is a stage nobody watches.
    expect(code).not.toMatch(/if \(Date\.now\(\) - startedAt < DEADLINE\)/);
  });

  it("lists every stage in STAGES", () => {
    const listed = new Set([...src.matchAll(/"([a-z]+)"/g)].map(m => m[1]));
    const used = [...code.matchAll(/stage\("([a-z]+)"/g)].map(m => m[1]).filter(n => n !== "aireplies");
    expect(used.length).toBeGreaterThan(15);
    for (const n of used) expect(listed.has(n), n).toBe(true);
    const block = src.slice(src.indexOf("const STAGES"), src.indexOf("];", src.indexOf("const STAGES")));
    for (const n of used) expect(block.includes(`"${n}"`), `${n} missing from STAGES`).toBe(true);
  });

  it("keeps the comment and review pollers out of the delivery deadline", () => {
    const afterBlock = code.slice(code.indexOf("after(async"), code.indexOf("try {", code.indexOf("after(async")));
    for (const n of ["ytcomments", "googlereviews", "kbsync", "igtokens"]) expect(afterBlock).toContain(`stage("${n}"`);
  });
});
