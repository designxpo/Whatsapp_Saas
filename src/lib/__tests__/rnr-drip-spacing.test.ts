// How close together the drip is allowed to talk.
//
// Every RNR template is category MARKETING, and Meta caps how many marketing
// messages one person may receive — error 131049, "not delivered to maintain
// healthy ecosystem engagement". When it bites the message is simply gone:
// nothing is delivered, no failure reaches the portal, and the journey
// advances as though it had sent. Three of five vanished that way on the
// 1 October test run.
//
// The brief's own numbers put FOUR marketing templates on four consecutive
// days once the counsellor's two are counted:
//
//     day 1  Message A      day 3  R+1  about us
//     day 2  Message B      day 4  R+2  course and roles
//
// These tests hold the drip apart. They are about frequency, not copy.
import { describe, it, expect } from "vitest";
import { rnrTemplates, rnrSteps, buildSteps } from "@/lib/rnrseed";

const OPTS = { centreName: "Gurgaon", courseName: "Data Analytics" } as never;
const live = () => rnrSteps(OPTS).filter(t => t.phase === "drip");
const days = () => live().map(t => t.day as number);

/** Message B lands the day before the lead is marked Not Reachable. */
const MESSAGE_B_DAY = 0;
/** No two marketing templates closer than this. */
const MIN_GAP_DAYS = 3;

describe("the drip's spacing", () => {
  it("found the steps — the control", () => {
    expect(live().length).toBeGreaterThanOrEqual(4);
    expect(days().every(d => typeof d === "number")).toBe(true);
  });

  it("does not open the day after the counsellor's second message", () => {
    expect(days()[0] - MESSAGE_B_DAY).toBeGreaterThanOrEqual(MIN_GAP_DAYS);
  });

  it("never puts two sends within three days of each other", () => {
    const d = days();
    const gaps = d.slice(1).map((x, i) => x - d[i]);
    expect(gaps.every(g => g >= MIN_GAP_DAYS)).toBe(true);
  });

  it("widens rather than narrows, so it tapers off", () => {
    const d = days();
    const gaps = d.slice(1).map((x, i) => x - d[i]);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
  });

  it("still finishes four weeks out, which is the part of the brief that means something", () => {
    expect(days()[days().length - 1]).toBe(28);
  });
});

describe("the day numbers stay in order", () => {
  it("ascends across ALL nine, including the two held back", () => {
    // buildSteps subtracts each day from the one before. A day out of
    // sequence clamps to zero and that step fires immediately after the
    // previous one — the exact burst this file exists to prevent.
    const all = rnrTemplates(OPTS).filter(t => t.day !== null).map(t => t.day as number);
    expect(all).toEqual([...all].sort((a, b) => a - b));
  });

  it("never produces a zero-minute wait between two drip sends", () => {
    const steps = buildSteps(rnrSteps(OPTS));
    expect(steps.slice(1).every(s => s.delayMinutes > 0)).toBe(true);
  });

  it("turns the days into the waits the engine actually uses", () => {
    const steps = buildSteps(rnrSteps(OPTS));
    expect(steps.map(s => s.delayMinutes / 1440)).toEqual([3, 4, 5, 6, 10]);
  });
});
