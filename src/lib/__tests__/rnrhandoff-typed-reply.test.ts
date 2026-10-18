// A student who TYPES a reply to an RNR message.
//
// Reported by the sales team, 15 Oct: "leads replies are not getting captured
// — if a student replies to the messages, where can we track it?"
//
// Traced on the live data. 917367870307 (Sanjay Sah, stage "Not Reachable")
// was sent rnr_01 on 13 Oct at 05:42 and wrote back at 09:22: "Sorry still
// not required but in future it would be then I will contact". The portal has
// it. mx_RNR_DRIP_LOGS on the lead in LeadSquared is null — and LeadSquared
// is where the counsellor looks.
//
// The cause is one condition. A message counted as part of the RNR
// conversation only if it STOPPED a sequence enrolment, or if it was a
// matched button TAP:
//
//     const wasNurtured = stopped > 0 || plan.intent !== "reply";
//
// A counsellor pressing "Send WhatsApp" in LeadSquared creates no enrolment —
// it sends the template and stamps the contact. So a lead nudged that way who
// TYPES rather than taps satisfies neither arm: stopped is 0, intent is
// "reply". No drip log, no CRM field, no task.
//
// Everyone whose reply did get through had tapped a button ("Yes, call me
// now", "👍"). That is the whole difference between the cases that worked and
// the ones that did not — and students type.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  attributes: {} as Record<string, string>,
  dripEvents: [] as { phone: string; line: string }[],
  fieldWrites: [] as { leadId: string; field: string; value: string }[],
  tasks: [] as unknown[],
  stopped: 0,
}));

vi.mock("../sequences", () => ({ stopAllEnrollments: async () => h.stopped }));
vi.mock("../driplog", async (orig) => {
  const real = await orig<typeof import("../driplog")>();
  return { ...real, recordDripEvent: async (phone: string, line: string) => { h.dripEvents.push({ phone, line }); } };
});
vi.mock("../leadsquared", () => ({
  ensureLead: async () => "lead-1",
  createLeadTask: async () => { h.tasks.push(1); return true; },
  setLeadField: async (leadId: string, field: string, value: string) => { h.fieldWrites.push({ leadId, field, value }); return true; },
}));
vi.mock("../store", () => ({
  setContactAttributes: async () => undefined,
  getContactByPhoneLoose: async () => ({ phone: "917367870307", attributes: h.attributes }),
  addOptout: async () => undefined,
}));
vi.mock("../whatsapp", () => ({ sendText: async () => ({ id: "x" }), sendButtons: async () => ({ id: "x" }), sendList: async () => ({ id: "x" }) }));

const { handleLeadResponse } = await import("../rnrhandoff");

const NUDGED_AT = "2026-10-13T05:42:00.000Z";
const REPLIED_AT = new Date("2026-10-13T09:22:00.000Z");

beforeEach(() => {
  process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_DRIP_LOGS";
  h.attributes = { rnr_nudge_a_at: NUDGED_AT };
  h.dripEvents = []; h.fieldWrites = []; h.tasks = []; h.stopped = 0;
});

describe("a typed reply to a counsellor's RNR nudge", () => {
  it("is recorded in the drip log", async () => {
    await handleLeadResponse("917367870307", "Sorry still not required but in future it would be", { now: REPLIED_AT });
    expect(h.dripEvents.length, "the reply was recorded nowhere").toBe(1);
    expect(h.dripEvents[0].line).toContain("Sorry still not required");
  });

  it("goes through the writer that pushes it to LeadSquared", async () => {
    // recordDripEvent owns mx_RNR_DRIP_LOGS — it appends to our copy and
    // overwrites the CRM field with the whole thread. It is mocked here, so
    // reaching it IS the assertion; rnrhandoff-one-writer.test.ts runs the
    // real one and checks what the field actually ends up holding.
    await handleLeadResponse("917367870307", "Sorry still not required but in future it would be", { now: REPLIED_AT });
    expect(h.dripEvents.length, "the CRM writer was never reached").toBe(1);
    expect(h.fieldWrites.length, "the field must have exactly one writer").toBe(0);
  });

  it("works for a nudge B as well as a nudge A", async () => {
    h.attributes = { rnr_nudge_b_at: NUDGED_AT };
    await handleLeadResponse("917367870307", "call me tomorrow please", { now: REPLIED_AT });
    expect(h.dripEvents.length).toBe(1);
  });
});

describe("what must STAY out of the RNR log", () => {
  it("an ordinary chat from someone never nudged", async () => {
    // The 14 Oct contamination: "Hi! I'd like to learn more about the courses"
    // from leads who had never been in the campaign at all.
    h.attributes = {};
    await handleLeadResponse("919999999999", "Hi! I'd like to learn more about the courses", { now: REPLIED_AT });
    expect(h.dripEvents.length, "ordinary chat leaked into the drip log").toBe(0);
    expect(h.fieldWrites.length).toBe(0);
  });

  it("a chat long after the nudge is over", async () => {
    // Nudged in October, chatting in December about something else. The
    // campaign is finished; this belongs on the WhatsApp timeline.
    h.attributes = { rnr_nudge_a_at: NUDGED_AT };
    await handleLeadResponse("917367870307", "what are the fees", { now: new Date("2026-12-01T10:00:00.000Z") });
    expect(h.dripEvents.length, "a months-old nudge kept claiming every message").toBe(0);
  });
});

describe("what already worked keeps working", () => {
  it("a button tap is still recorded", async () => {
    h.attributes = {};
    await handleLeadResponse("916360540071", "Yes, call me now", { now: REPLIED_AT });
    expect(h.dripEvents.length).toBe(1);
  });

  it("a reply that stops a live drip is still recorded", async () => {
    h.attributes = {};
    h.stopped = 1;
    await handleLeadResponse("919955244132", "please stop messaging", { now: REPLIED_AT });
    expect(h.dripEvents.length).toBe(1);
  });
});
