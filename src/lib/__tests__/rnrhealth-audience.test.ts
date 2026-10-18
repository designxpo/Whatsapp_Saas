// The audience lists in the database are a frozen copy.
//
// rnrseed generates each gated step's course list from PROGRAMMES, and
// setSequenceSteps writes that list into wa_sequence_steps. From then on the
// two are independent: adding a course to PROGRAMMES changes the constants in
// code, changes what the tests assert, and changes nothing whatsoever about
// the leads the live drip reaches.
//
// That matters now rather than hypothetically. LeadSquared holds 17 course
// names this table does not have — measured 14 Oct against 4,033 leads on
// "Not Reachable" — so the next change to PROGRAMMES is already queued, and
// without this check the drip would go on reaching nobody while every signal
// we have said it was fixed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  steps: [] as { stepIndex: number; delayMinutes: number; action: unknown; audience: unknown }[],
}));

vi.mock("../stagepoll", () => ({
  getStagePoll: async () => ({
    enabled: true, mode: "apply", stage: "Not Reachable", maxPerRun: 50,
    lastRunAt: new Date().toISOString(), lastApplied: 1, lastCandidates: 1,
  }),
}));
vi.mock("../stagedrips", () => ({ getStageDrips: async () => [{ stage: "Not Reachable", sequenceId: "seq-1" }] }));
vi.mock("../sequences", () => ({
  listSequences: async () => [{ id: "seq-1", name: "RNR follow-up", active: true, channelId: "ch-1", platform: "whatsapp" }],
  getSequenceSteps: async () => h.steps,
}));
vi.mock("../channels", () => ({
  credsFor: async () => ({ token: "t", phoneNumberId: "1" }),
  getChannel: async () => ({ id: "ch-1", name: "PPC SM" }),
}));
vi.mock("../whatsapp", () => ({ fetchTemplates: async () => [] }));
vi.mock("../driplog", () => ({ DRIP_LOG_FIELD: () => "mx_RNR_DRIP_LOGS" }));

const { checkStageDrip } = await import("../rnrhealth");
const { rnrSteps } = await import("../rnrseed");

/** The steps exactly as the seeder would build them today. */
const seeded = () =>
  rnrSteps({ channelId: "ch-1" }).map((t, i) => ({
    stepIndex: i, delayMinutes: (t.day ?? 0) * 1440,
    action: { type: "template", templateName: t.templateName, params: t.params, languageCode: "en_US" },
    audience: t.audience,
  }));

const drift = async () => (await checkStageDrip()).find(c => c.key === "rnr-audience");

beforeEach(() => { h.steps = seeded(); });

describe("the audience rules against the table they came from", () => {
  it("says nothing when the sequence matches the programme table", async () => {
    expect(await drift()).toBeUndefined();
  });

  it("is not fooled by reordering", async () => {
    // Reordering PROGRAMMES changes the array order and not one lead. A check
    // that cried drift over it would be switched off within a week.
    h.steps = seeded().map(s => {
      const a = s.audience as { attrIn?: Record<string, string[]> } | null;
      if (!a?.attrIn) return s;
      const attrIn = Object.fromEntries(Object.entries(a.attrIn).map(([k, v]) => [k, [...v].reverse()]));
      return { ...s, audience: { ...a, attrIn } };
    });
    expect(await drift()).toBeUndefined();
  });

  it("catches a course ADDED to the table but never re-seeded", async () => {
    // The exact shape of the change that is coming: the code learns a course,
    // the database does not, and the step still reaches nobody.
    h.steps = seeded().map(s => {
      const a = s.audience as { attrIn?: Record<string, string[]> } | null;
      if (!a?.attrIn?.["Product Name"]) return s;
      const kept = a.attrIn["Product Name"].slice(1);
      return { ...s, audience: { ...a, attrIn: { ...a.attrIn, "Product Name": kept } } };
    });
    const c = await drift();
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("rnr_04_course_roles");
    expect(c?.detail).toMatch(/re-seed/i);
  });

  it("catches a step whose audience was dropped altogether", async () => {
    // 0103 unapplied, or a hand-edit through the sequence editor. The step
    // then goes to EVERYONE, which for day 12 is a salary claim to leads we
    // cannot make it for.
    h.steps = seeded().map(s => ({ ...s, audience: null }));
    const c = await drift();
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("rnr_06_results");
  });

  it("ignores a step the seeder does not own", async () => {
    // A hand-added step is somebody's deliberate choice, not drift.
    h.steps = [...seeded(), {
      stepIndex: 9, delayMinutes: 100,
      action: { type: "template", templateName: "something_hand_added" },
      audience: { attrIn: { city: ["mars"] } },
    }];
    expect(await drift()).toBeUndefined();
  });
});
