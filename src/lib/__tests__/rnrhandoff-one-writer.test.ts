// Two writers, one CRM field.
//
// recordDripEvent appends the reply to our own copy of the log and then
// overwrites mx_RNR_DRIP_LOGS with the WHOLE rendered conversation — that is
// its documented design, because LeadSquared's reads lag its writes and a
// read-modify-write would lose lines.
//
// handleLeadResponse then wrote the SAME field again with plan.activity, a
// single line. Both resolve LSQ_RNR_RESPONSE_FIELD, so they are the same
// field, and the second write replaces the conversation with one line of it.
//
// It was invisible while typed replies were being dropped entirely: the only
// messages reaching either writer were button taps, where the log is short
// and the activity line looks much like it. Fixing the typed-reply gate is
// what would have exposed it — a lead with four exchanges would have shown
// the counsellor only the last one.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  attributes: {} as Record<string, string>,
  fieldWrites: [] as { field: string; value: string }[],
  stored: [] as Record<string, string>[],
}));

vi.mock("../sequences", () => ({ stopAllEnrollments: async () => 0 }));
vi.mock("../leadsquared", () => ({
  ensureLead: async () => "lead-1",
  createLeadTask: async () => true,
  setLeadField: async (_id: string, field: string, value: string) => { h.fieldWrites.push({ field, value }); return true; },
}));
vi.mock("../store", () => ({
  setContactAttributes: async (_p: string, a: Record<string, string>) => { h.stored.push(a); Object.assign(h.attributes, a); },
  getContactByPhoneLoose: async () => ({ phone: "917367870307", attributes: h.attributes }),
  addOptout: async () => undefined,
}));
vi.mock("../whatsapp", () => ({ sendText: async () => ({ id: "x" }), sendButtons: async () => ({ id: "x" }), sendList: async () => ({ id: "x" }) }));

const { handleLeadResponse } = await import("../rnrhandoff");

const NUDGED_AT = "2026-10-13T05:42:00.000Z";

beforeEach(() => {
  process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_DRIP_LOGS";
  h.attributes = { rnr_nudge_a_at: NUDGED_AT };
  h.fieldWrites = []; h.stored = [];
});

describe("the CRM field has exactly one writer", () => {
  it("is written once per reply, not twice", async () => {
    await handleLeadResponse("917367870307", "Sorry still not required", { now: new Date("2026-10-13T09:22:00Z") });
    expect(h.fieldWrites.length, `written ${h.fieldWrites.length} times: ${JSON.stringify(h.fieldWrites)}`).toBe(1);
  });

  it("receives the whole conversation, not just the latest line", async () => {
    // Three exchanges. A counsellor opening the lead must see the thread.
    await handleLeadResponse("917367870307", "who is this", { now: new Date("2026-10-13T09:00:00Z") });
    await handleLeadResponse("917367870307", "what are the fees", { now: new Date("2026-10-13T09:10:00Z") });
    await handleLeadResponse("917367870307", "ok call me", { now: new Date("2026-10-13T09:20:00Z") });

    const last = h.fieldWrites.at(-1)!.value;
    expect(last).toContain("who is this");
    expect(last).toContain("what are the fees");
    expect(last).toContain("ok call me");
  });

  it("keeps our own copy and the CRM copy identical", async () => {
    await handleLeadResponse("917367870307", "Sorry still not required", { now: new Date("2026-10-13T09:22:00Z") });
    expect(h.fieldWrites.at(-1)!.value).toBe(h.attributes.rnr_drip_log);
  });
});
