// What the Drip Analytics screen promises, and the four ways it was lying.
//
// The feature shipped without a test, and every defect below is the same
// shape: the server accepted an input, echoed it back in `filter`, and then
// ignored it — so the screen looked responsive and answered the wrong
// question. The assertions here are written against the SYMPTOM a user would
// report, not the implementation, so a refactor that keeps the behaviour keeps
// the test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startOfDayIn } from "../businessclock";

type Row = Record<string, unknown>;

const store = {
  sequences: [] as Row[],
  steps: [] as Row[],
  enrollments: [] as Row[],
};
/** Every .gte()/.eq() the analytics query built, so a window can be asserted. */
let filters: { table: string; op: string; col: string; val: unknown }[] = [];

function chain(table: string) {
  const eqs: [string, unknown][] = [];
  const rows = () => {
    const src = table === "wa_sequences" ? store.sequences
      : table === "wa_sequence_steps" ? store.steps
      : table === "wa_sequence_enrollments" ? store.enrollments : [];
    return src.filter(r => eqs.every(([c, v]) => r[c] === v));
  };
  const o: Record<string, unknown> = {
    select: () => o,
    order: () => o,
    limit: () => o,
    eq: (c: string, v: unknown) => { eqs.push([c, v]); filters.push({ table, op: "eq", col: c, val: v }); return o; },
    gte: (c: string, v: unknown) => { filters.push({ table, op: "gte", col: c, val: v }); return o; },
    ilike: () => o,
    in: () => o,
    // PostgREST's real ceiling: pageAll() is the only reason a caller ever
    // sees row 1,001, so the double has to honour the window it asks for.
    range: async (from: number, to: number) => ({ data: rows().slice(from, to + 1), error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null, count: rows().length }).then(res),
  };
  return o;
}

vi.mock("../tenantdb", () => ({ tdb: () => ({ from: (t: string) => chain(t) }) }));

import { getDripAnalytics, dripRangeStart, parseDripRange } from "../sequences";

const seq = (id: string, name: string, platform = "whatsapp") => ({
  id, tenant_id: "t1", name, platform, trigger_kind: "manual", trigger_value: null, active: true,
});
const step = (sequence_id: string, step_index: number) => ({
  id: `${sequence_id}-${step_index}`, sequence_id, step_index,
  delay_minutes: step_index * 1440, action: { type: "text", text: `step ${step_index}` },
});
/** Relative to now, so a 7-day window test does not expire on a calendar date. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const TWO_DAYS_AGO = daysAgo(2);

const enr = (id: string, current_step: number, status: string, created_at: string, sequence_id = "s1") => ({
  id, sequence_id, platform: "whatsapp", current_step, status,
  last_error: status === "failed" ? "  send   failed  " : null,
  created_at, updated_at: created_at,
});

beforeEach(() => {
  filters = [];
  store.sequences = [seq("s1", "RNR follow-up")];
  store.steps = [step("s1", 0), step("s1", 1), step("s1", 2)];
  // One lead parked on each rung, plus one of every terminal state.
  store.enrollments = [
    enr("e1", 0, "active",    TWO_DAYS_AGO),
    enr("e2", 1, "active",    TWO_DAYS_AGO),
    enr("e3", 2, "active",    TWO_DAYS_AGO),
    enr("e4", 2, "completed", TWO_DAYS_AGO),
    enr("e5", 1, "stopped",   TWO_DAYS_AGO),
    enr("e6", 0, "failed",    TWO_DAYS_AGO),
  ];
});

describe("the status filter", () => {
  it("narrows the figures instead of being echoed back unused", async () => {
    const all = await getDripAnalytics({});
    expect(all.overview.totalEnrolled).toBe(6);

    const done = await getDripAnalytics({ status: "completed" });
    expect(done.overview.totalEnrolled).toBe(1);
    expect(done.overview.completed).toBe(1);
    expect(done.overview.active).toBe(0);
    expect(done.bySequence[0].totalEnrolled).toBe(1);
  });

  it("leaves the pill counts on the whole cohort, so you can click back out", async () => {
    const done = await getDripAnalytics({ status: "completed" });
    expect(done.statusCounts.totalEnrolled).toBe(6);
    expect(done.statusCounts.active).toBe(3);
    expect(done.statusCounts.stopped).toBe(1);
    expect(done.statusCounts.failed).toBe(1);
  });
});

describe("the date window", () => {
  it("treats Today as the business day, not as all time", () => {
    expect(parseDripRange("today")).toBe("today");
    const start = dripRangeStart("today");
    expect(start).not.toBeNull();
    expect(start!.toISOString()).toBe(startOfDayIn(new Date()).toISOString());
  });

  it("puts a lower bound on the query when Today is picked", async () => {
    await getDripAnalytics({ range: "today" });
    const bound = filters.find(f => f.table === "wa_sequence_enrollments" && f.op === "gte" && f.col === "created_at");
    expect(bound).toBeDefined();
    expect(bound!.val).toBe(startOfDayIn(new Date()).toISOString());
  });

  it("asks for everything when the range is all time", async () => {
    await getDripAnalytics({ range: "all" });
    expect(filters.some(f => f.table === "wa_sequence_enrollments" && f.op === "gte")).toBe(false);
  });

  it("falls back to all time for a range it does not recognise", async () => {
    const out = await getDripAnalytics({ range: "last-tuesday" });
    expect(out.filter.range).toBe("all");
    expect(out.overview.totalEnrolled).toBe(6);
  });
});

describe("the step funnel", () => {
  it("counts a step as reached only once it has actually been sent", async () => {
    const out = await getDripAnalytics({});
    const steps = out.bySequence[0].steps;

    // current_step is the step ABOUT to go out. e1 is waiting on step 0 and
    // has had nothing; counting it as having reached step 0 is what made the
    // funnel read 100% at every rung.
    expect(steps[0].reachedCount).toBe(4);   // e2 e3 e4 e5
    expect(steps[1].reachedCount).toBe(2);   // e3 e4
    expect(steps[2].reachedCount).toBe(1);   // e4, via completed
  });

  it("falls monotonically, which is the only thing that makes it a funnel", async () => {
    const steps = (await getDripAnalytics({})).bySequence[0].steps;
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].reachedCount).toBeLessThanOrEqual(steps[i - 1].reachedCount);
      expect(steps[i].retentionRate).toBeLessThanOrEqual(steps[i - 1].retentionRate);
    }
  });

  it("separates who is waiting on a step from who dropped out at it", async () => {
    const steps = (await getDripAnalytics({})).bySequence[0].steps;
    expect(steps[0].currentlyOn).toBe(1);    // e1
    expect(steps[0].failedCount).toBe(1);    // e6
    expect(steps[1].currentlyOn).toBe(1);    // e2
    expect(steps[1].stoppedCount).toBe(1);   // e5
    expect(steps[2].currentlyOn).toBe(1);    // e3
  });

  it("groups the same failure as the same failure", async () => {
    store.enrollments.push(enr("e7", 0, "failed", TWO_DAYS_AGO));
    const errors = (await getDripAnalytics({})).bySequence[0].errors;
    expect(errors).toEqual([{ error: "send failed", count: 2 }]);
  });
});

describe("reading past PostgREST's ceiling", () => {
  it("counts every enrolment, not the first thousand", async () => {
    store.enrollments = Array.from({ length: 2_350 }, (_, i) =>
      enr(`b${i}`, 0, "active", TWO_DAYS_AGO));
    const out = await getDripAnalytics({});
    expect(out.overview.totalEnrolled).toBe(2_350);
    expect(out.scanned).toBe(2_350);
    expect(out.truncated).toBe(false);
  });
});

describe("the enrolment trend", () => {
  it("emits a bucket for every day in the window, including the quiet ones", async () => {
    const out = await getDripAnalytics({ range: "7d" });
    expect(out.granularity).toBe("day");
    expect(out.dailyTrend).toHaveLength(7);
    expect(out.dailyTrend.every(b => typeof b.enrolled === "number")).toBe(true);
    // Zero-filled, not collapsed: a gap has to stay a gap.
    expect(out.dailyTrend.filter(b => b.enrolled === 0).length).toBeGreaterThan(0);
  });
});
