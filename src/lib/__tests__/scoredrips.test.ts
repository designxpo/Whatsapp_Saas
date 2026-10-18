// Starting a nurture when a counsellor grades a lead.
//
// LeadSquared carries two gradings and the business uses both: ProspectStage,
// which moves as the lead progresses, and mx_Lead_Score, which a person sets
// by hand on the call — Hot, Warm, Cold, Junk here. Stage drips already
// existed; this is the other axis.
//
// The rules are shared with stage drips rather than copied, so most of what
// matters here is that the two maps stay SEPARATE: a lead re-graded Hot must
// not be enrolled out of, or into, a stage-managed nurture it was never
// configured for.
import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, unknown>();
vi.mock("../store", () => ({
  getSetting: async (k: string, fallback: unknown) => (settings.has(k) ? settings.get(k) : fallback),
  setSetting: async (k: string, v: unknown) => { settings.set(k, v); },
  // This codebase scopes settings by tenant; the fake keeps one namespace because
  // each test is a single workspace.
  getTenantSetting: async (_t: string, k: string, fallback: unknown) => (settings.has(k) ? settings.get(k) : fallback),
  setTenantSetting: async (_t: string, k: string, v: unknown) => { settings.set(k, v); },
}));

import { getScoreDrips, setScoreDrips, scoreTransition, KNOWN_SCORES, type ScoreDrip } from "../scoredrips";
import { getStageDrips, setStageDrips } from "../stagedrips";

const rules: ScoreDrip[] = [
  { score: "Hot", sequenceId: "seq-hot" },
  { score: "Warm", sequenceId: "seq-warm" },
];

beforeEach(() => settings.clear());

describe("what a re-grading does", () => {
  it("starts the new grade's sequence", () => {
    expect(scoreTransition("Cold", "Hot", rules)).toEqual({ enroll: "seq-hot", stop: ["seq-warm"] });
  });

  it("stops the other score nurtures — the lead has been re-graded", () => {
    expect(scoreTransition("Hot", "Warm", rules).stop).toEqual(["seq-hot"]);
  });

  it("does nothing at all when the grade has not changed", () => {
    // The load-bearing one. LeadSquared retries a webhook it thinks failed, and
    // a second enrolment would restart the lead at step one — re-sending the
    // opening message to someone who already had it.
    expect(scoreTransition("Hot", "Hot", rules)).toEqual({ enroll: null, stop: [] });
    expect(scoreTransition("hot", "  HOT  ", rules)).toEqual({ enroll: null, stop: [] });
  });

  it("ignores case and padding, because a CRM value is typed by a person", () => {
    expect(scoreTransition("cold", "  hot ", rules).enroll).toBe("seq-hot");
  });

  it("stops everything when the lead is graded into something unmapped", () => {
    // Graded Junk with no Junk rule: whatever was nurturing them should not
    // carry on.
    expect(scoreTransition("Hot", "Junk", rules)).toEqual({ enroll: null, stop: ["seq-hot", "seq-warm"] });
  });

  it("does not restart a nurture when both grades point at the same sequence", () => {
    const same: ScoreDrip[] = [{ score: "Hot", sequenceId: "s1" }, { score: "Warm", sequenceId: "s1" }];
    expect(scoreTransition("Warm", "Hot", same)).toEqual({ enroll: null, stop: [] });
  });

  it("does nothing when there is no new grade", () => {
    expect(scoreTransition("Hot", "", rules)).toEqual({ enroll: null, stop: [] });
  });
});

describe("the two maps are separate", () => {
  it("saving score rules does not touch the stage rules, or the reverse", async () => {
    // They are configured on different screens and mean different things. One
    // settings key shared between them would silently overwrite whichever was
    // saved first.
    await setStageDrips([{ stage: "Enrolled", sequenceId: "seq-onboarding" }]);
    await setScoreDrips(rules);

    expect(await getStageDrips()).toEqual([{ stage: "Enrolled", sequenceId: "seq-onboarding" }]);
    expect(await getScoreDrips()).toEqual(rules);
  });

  it("a score map never enrols into a stage-managed sequence", async () => {
    await setStageDrips([{ stage: "Hot", sequenceId: "seq-stage-hot" }]);
    await setScoreDrips([{ score: "Hot", sequenceId: "seq-score-hot" }]);
    // "Hot" exists on BOTH axes in this account, which is exactly how a shared
    // map would go unnoticed.
    expect(scoreTransition("Cold", "Hot", await getScoreDrips()).enroll).toBe("seq-score-hot");
  });
});

describe("what gets stored", () => {
  it("drops blank rows and keeps the first rule for a repeated grade", async () => {
    await setScoreDrips([
      { score: "Hot", sequenceId: "first" },
      { score: " hot ", sequenceId: "second" },
      { score: "", sequenceId: "orphan" },
      { score: "Warm", sequenceId: "" },
    ] as ScoreDrip[]);
    expect(await getScoreDrips()).toEqual([{ score: "Hot", sequenceId: "first" }]);
  });

  it("suggests the grades this CRM actually offers", () => {
    expect([...KNOWN_SCORES]).toEqual(["Hot", "Warm", "Cold", "Junk"]);
  });
});
