// Stamping the course and city a lead's drip is addressed by.
//
// Three of the five RNR steps are `attrIn` rules over "Product Name" and
// "city", and attrIn reads a MISSING value as "no" — deliberately, because
// day 12 makes a salary and refund claim we must be able to stand behind.
// So a lead arriving without them receives day 3 and day 28 and nothing in
// between: a four-week nurture that is two messages 25 days apart.
//
// Until the poll carried these fields, that was every lead it created.
//
// The stakes are asymmetric and run the other way too. A junk course is
// worse than no course: mx_Course_Interested is about four-fifths "66" and
// "Select" on this instance, and stamping that would put a lead into the
// day 7 and day 12 audiences holding a value no message can render. So only
// a course that resolves to a real programme is ever written.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  existing: null as { phone: string; attributes: Record<string, string> } | null,
  attrWrites: [] as { phone: string; attrs: Record<string, string> }[],
}));

vi.mock("../store", () => ({
  upsertContacts: async () => ({ inserted: 1, skipped: 0 }),
  getContactByPhoneLoose: async () => h.existing,
  setContactAttributes: async (phone: string, attrs: Record<string, string>) => { h.attrWrites.push({ phone, attrs }); },
  getConversationByPhone: async () => null,
  isOptedOut: async () => false,
  optoutSet: async () => new Set<string>(),
  setBotEnabled: async () => undefined,
  getOrCreateConversation: async () => ({ id: "c1" }),
  appendConvMessage: async () => undefined,
  touchOutbound: async () => undefined,
  claimWelcome: async () => false,
}));
vi.mock("../handover", () => ({ syncOwnerByPhone: async () => ({ assigned: false }) }));
vi.mock("../stagedrips", () => ({ getStageDrips: async () => [], stageTransition: () => ({ enroll: null, stop: [] }) }));
vi.mock("../scoredrips", () => ({ getScoreDrips: async () => [], scoreTransition: () => ({ enroll: null, stop: [] }) }));
vi.mock("../sequences", () => ({ stopMarketingEnrollments: async () => 0, enroll: async () => undefined, stopEnrollment: async () => undefined }));
vi.mock("../leadwelcome", () => ({ getLeadWelcome: async () => ({ enabled: false }), shouldWelcome: () => false, toWaNumber: (p: string) => p }));
vi.mock("../whatsapp", () => ({ sendTemplateSingle: async () => ({ id: "wamid.x" }) }));
vi.mock("../channels", () => ({ getDefaultChannel: async () => null }));

const { applyLsqLead } = await import("../lsqapply");

const base = {
  event: "stage_changed" as const,
  phone: "918368872108", name: "Priyesh", email: null,
  ownerEmail: null, ownerName: null, stage: "Not Reachable",
  leadScore: null, leadId: "lead-1", source: null,
  course: null as string | null, city: null as string | null,
};

const written = () => Object.assign({}, ...h.attrWrites.map(w => w.attrs)) as Record<string, string>;

beforeEach(() => {
  h.existing = { phone: "918368872108", attributes: {} };
  h.attrWrites = [];
});

describe("the course the drip is addressed by", () => {
  it("stamps a real programme, in the CRM's own spelling", async () => {
    // Not our display name: the audience lists are built from crmNames, and
    // leadtokens turns it into prose at send time.
    await applyLsqLead({ ...base, course: "Adv. Cert. in Data Analytics & AI" });
    expect(written()["Product Name"]).toBe("Adv. Cert. in Data Analytics & AI");
  });

  it("REFUSES the junk that fills four-fifths of that field", async () => {
    // 967 of 1,211 values were "66" when last counted. Stamping one puts a
    // lead in an audience no message can render for them.
    for (const junk of ["66", "Select", "--", "0", "test"]) {
      h.attrWrites = [];
      await applyLsqLead({ ...base, course: junk });
      expect(written()["Product Name"], junk).toBeUndefined();
    }
  });

  it("never overwrites a course the lead told US", async () => {
    // A course from our own form or conversation is better evidence than
    // one typed into the CRM months ago.
    h.existing = { phone: "918368872108", attributes: { "Product Name": "Full Stack AI" } };
    await applyLsqLead({ ...base, course: "Adv. Cert. in Data Analytics & AI" });
    expect(written()["Product Name"]).toBeUndefined();
  });

  it("fills one that is present but blank", async () => {
    h.existing = { phone: "918368872108", attributes: { "Product Name": "   " } };
    await applyLsqLead({ ...base, course: "Certified Business Analytics" });
    expect(written()["Product Name"]).toBe("Certified Business Analytics");
  });
});

describe("the city the centre invitation is addressed by", () => {
  it("stamps it", async () => {
    await applyLsqLead({ ...base, city: "Gurgaon" });
    expect(written().city).toBe("Gurgaon");
  });

  it("does not overwrite one we already hold", async () => {
    h.existing = { phone: "918368872108", attributes: { city: "Noida" } };
    await applyLsqLead({ ...base, city: "Gurgaon" });
    expect(written().city).toBeUndefined();
  });

  it("is not filtered the way the course is", async () => {
    // A city we do not recognise still fails the centre gate by not being in
    // CENTRE_CITIES, so there is nothing to protect against and no reason to
    // discard what the CRM holds.
    await applyLsqLead({ ...base, city: "Indore" });
    expect(written().city).toBe("Indore");
  });
});

describe("what it leaves alone", () => {
  it("writes neither when the payload carries neither", async () => {
    await applyLsqLead(base);
    const w = written();
    expect(w["Product Name"]).toBeUndefined();
    expect(w.city).toBeUndefined();
    expect(w.lsq_stage).toBe("Not Reachable");   // the rest still happens
  });
});

// The tracked link as a fallback source of truth (14 Oct).
//
// mx_Course_Interested is unusable on every one of the 1,000 most recent Not
// Reachable leads — 254 hold the literal "66". But a lead who arrived on
// ppc-wa-ds-delhi told us their course at the moment of the click, and
// handle_source has been sitting on their contact ever since. Without this
// the drip's three gated steps had no way to address them at all.
describe("the course the tracked link implies", () => {
  it("is used when LeadSquared has nothing", async () => {
    h.existing = { phone: "918368872108", attributes: { handle_source: "ppc-wa-ds-delhi" } };
    await applyLsqLead({ ...base, course: null });
    expect(written()["Product Name"]).toBe("Adv. Cert. in Data Science & GenAI");
  });

  it("loses to a real value from LeadSquared", async () => {
    // The CRM naming a course outranks a link implying one.
    h.existing = { phone: "918368872108", attributes: { handle_source: "ppc-wa-ds-delhi" } };
    await applyLsqLead({ ...base, course: "Adv. Cert. in Data Analytics & AI" });
    expect(written()["Product Name"]).toBe("Adv. Cert. in Data Analytics & AI");
  });

  it("still loses to a course the lead gave US", async () => {
    h.existing = { phone: "918368872108", attributes: { handle_source: "ppc-wa-ds-delhi", "Product Name": "Full Stack AI" } };
    await applyLsqLead({ ...base, course: null });
    expect(written()["Product Name"]).toBeUndefined();
  });

  it("writes nothing for a link that names no course", async () => {
    for (const l of ["ppc-wa-placement", "Callback", "organic-whatsapp"]) {
      h.attrWrites = [];
      h.existing = { phone: "918368872108", attributes: { handle_source: l } };
      await applyLsqLead({ ...base, course: null });
      expect(written()["Product Name"], l).toBeUndefined();
    }
  });

  it("rescues a lead whose CRM course is the junk value", async () => {
    // The exact live case: mx_Course_Interested = "66", arrived on a DA link.
    h.existing = { phone: "918368872108", attributes: { handle_source: "ppc-wa-da-noida" } };
    await applyLsqLead({ ...base, course: "66" });
    expect(written()["Product Name"]).toBe("Adv. Cert. in Data Analytics & AI");
  });
});
