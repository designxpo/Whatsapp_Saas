// The log must be written against the contact we FOUND, not the number we
// were handed.
//
// recordDripEvent reads with getContactByPhoneLoose, which is suffix-aware,
// and used to write with setContactAttributes, which is an exact match that
// returns silently when it finds nothing. Hand it "8368872108" and the read
// finds "918368872108" while the write looks for a contact that does not
// exist and does nothing at all.
//
// That is how a whole run's drip history vanished on 1 October: five
// messages sent, no log on the contact, no error raised, nothing to notice.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  contact: null as { phone: string; attributes: Record<string, string> } | null,
  writes: [] as { phone: string; attrs: Record<string, string> }[],
  leadFields: [] as { leadId: string; field: string; value: string }[],
}));

vi.mock("../store", () => ({
  getContactByPhoneLoose: async () => h.contact,
  setContactAttributes: async (phone: string, attrs: Record<string, string>) => { h.writes.push({ phone, attrs }); },
}));
vi.mock("../leadsquared", () => ({
  ensureLead: async () => "lead-1",
  setLeadField: async (leadId: string, field: string, value: string) => { h.leadFields.push({ leadId, field, value }); return true; },
}));

import { recordDripEvent, DRIP_LOG_ATTR } from "../driplog";

beforeEach(() => {
  h.contact = { phone: "918368872108", attributes: {} };
  h.writes = [];
  h.leadFields = [];
  delete process.env.LSQ_RNR_RESPONSE_FIELD;
});

describe("which contact the drip log lands on", () => {
  it("writes to the stored number when handed a bare ten-digit one", async () => {
    await recordDripEvent("8368872108", "01Oct 19:11 → about us");
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].phone).toBe("918368872108");
  });

  it("writes the line itself, not an empty value", async () => {
    await recordDripEvent("8368872108", "01Oct 19:11 → about us");
    expect(h.writes[0].attrs[DRIP_LOG_ATTR]).toBe("01Oct 19:11 → about us");
  });

  it("appends to the history already on that contact", async () => {
    h.contact = { phone: "918368872108", attributes: { [DRIP_LOG_ATTR]: "01Oct 19:11 → about us" } };
    await recordDripEvent("8368872108", "01Oct 19:19 → centre visit");
    expect(h.writes[0].attrs[DRIP_LOG_ATTR].split("\n")).toEqual([
      "01Oct 19:11 → about us",
      "01Oct 19:19 → centre visit",
    ]);
  });

  it("falls back to the given number when no contact exists at all", async () => {
    // Nothing to be canonical about — still better than dropping the write.
    h.contact = null;
    await recordDripEvent("918368872108", "01Oct 19:11 → about us");
    expect(h.writes[0].phone).toBe("918368872108");
  });

  it("mirrors the whole value to the CRM field once one is configured", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_DRIP_LOGS";
    h.contact = { phone: "918368872108", attributes: { [DRIP_LOG_ATTR]: "01Oct 19:11 → about us" } };
    await recordDripEvent("8368872108", "01Oct 19:19 → centre visit");
    expect(h.leadFields).toHaveLength(1);
    expect(h.leadFields[0].field).toBe("mx_RNR_DRIP_LOGS");
    expect(h.leadFields[0].value).toContain("01Oct 19:11 → about us");
    expect(h.leadFields[0].value).toContain("01Oct 19:19 → centre visit");
  });

  it("still keeps our own copy when no CRM field is configured", async () => {
    await recordDripEvent("8368872108", "01Oct 19:11 → about us");
    expect(h.writes).toHaveLength(1);
    expect(h.leadFields).toHaveLength(0);
  });
});
