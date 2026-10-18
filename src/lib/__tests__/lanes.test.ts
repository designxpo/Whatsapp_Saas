// Which funnel a lead is in.
//
// Marketing and Sales each run a full Attention → Interest → Desire → Action
// journey, on different audiences and in different voices. Marketing speaks to
// strangers at scale; Sales speaks as the counsellor who owns the lead. The
// whole point of the split is that neither reaches the other's audience, so
// almost everything worth testing here is a refusal.
import { describe, it, expect, vi, beforeEach } from "vitest";

let contact: { attributes?: Record<string, string> } | null = null;
let throwOnRead = false;
vi.mock("../store", () => ({
  getContactByPhoneLoose: async () => { if (throwOnRead) throw new Error("db down"); return contact; },
}));
vi.mock("../supabase", () => ({ db: () => { throw new Error("db() not used by these tests"); } }));

import { leadLane, laneAllows, isLane, isAidaStage, AIDA_LABELS, AIDA_STAGES, LANES } from "../lanes";

beforeEach(() => { contact = null; throwOnRead = false; });

describe("which lane a lead is in", () => {
  it("sales once a counsellor owns them", async () => {
    contact = { attributes: { lsq_owner: "Arup Dey" } };
    expect(await leadLane("919000000001")).toBe("sales");
  });

  it("marketing when nobody owns them", async () => {
    contact = { attributes: { lsq_stage: "Enquiry" } };
    expect(await leadLane("919000000001")).toBe("marketing");
  });

  it("marketing for a contact we have never seen", async () => {
    contact = null;
    expect(await leadLane("919000000001")).toBe("marketing");
  });

  it("a BLANK owner is not ownership", async () => {
    // The load-bearing one. A LeadSquared automation that posts an empty owner
    // field would otherwise move every lead it touched into the sales lane,
    // where no marketing journey can ever reach them again — and nothing would
    // report it, because the leads simply stop being enrolled.
    for (const v of ["", " ", "   ", "\t"]) {
      contact = { attributes: { lsq_owner: v } };
      expect(await leadLane("919000000001"), JSON.stringify(v)).toBe("marketing");
    }
  });

  it("falls to MARKETING when the contact cannot be read", async () => {
    // The safe direction on a database error: marketing journeys are written
    // for strangers. Guessing sales would enrol somebody into a counsellor's
    // personal nurture on the strength of a timeout.
    throwOnRead = true;
    expect(await leadLane("919000000001")).toBe("marketing");
  });
});

describe("what a journey will accept", () => {
  it("takes its own lane and refuses the other", () => {
    expect(laneAllows("marketing", "marketing")).toBe(true);
    expect(laneAllows("marketing", "sales")).toBe(false);
    expect(laneAllows("sales", "sales")).toBe(true);
    expect(laneAllows("sales", "marketing")).toBe(false);
  });

  it("an UNFILED journey accepts anybody", () => {
    // Sequences that predate the lanes. Refusing them would have switched off
    // a working automation on the day this shipped.
    for (const t of [null, undefined, ""]) {
      expect(laneAllows(t, "sales"), String(t)).toBe(true);
      expect(laneAllows(t, "marketing"), String(t)).toBe(true);
    }
  });

  it("an ops or api journey is unchecked — neither runs a funnel", () => {
    // The column accepts all four team values so it means the same thing
    // everywhere, but only two of them have an audience.
    for (const t of ["ops", "api"]) {
      expect(laneAllows(t, "sales"), t).toBe(true);
      expect(laneAllows(t, "marketing"), t).toBe(true);
    }
  });
});

describe("the vocabulary", () => {
  it("offers exactly the two lanes that have a funnel", () => {
    expect([...LANES]).toEqual(["marketing", "sales"]);
    expect(isLane("ops")).toBe(false);
    expect(isLane("marketing")).toBe(true);
  });

  it("covers AIDA plus what happens after the sale", () => {
    expect([...AIDA_STAGES]).toEqual(["attention", "interest", "desire", "action", "retention"]);
    expect(isAidaStage("desire")).toBe(true);
    expect(isAidaStage("consideration")).toBe(false);
  });

  it("says what each stage is FOR, not just its name", () => {
    // The stage exists to make a missing rung visible to a human. A label with
    // no job description is a word, and the operator has to already know AIDA
    // to use it.
    for (const s of AIDA_STAGES) {
      expect(AIDA_LABELS[s].job.length, s).toBeGreaterThan(25);
      expect(AIDA_LABELS[s].job.trim().endsWith("."), s).toBe(true);
    }
  });
});
