// A web-chat visitor who typed someone else's number (labelled unverified by
// landCapturedLead) must never have their lead score pushed onto that other
// person's CRM lead.
import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase", () => ({ db: () => ({}) }));
import { crmPhoneOf } from "../lead-intel";
import { UNVERIFIED_PHONE_LABEL } from "../store";

describe("which phone the lead scorer may push to the CRM", () => {
  it("uses a WhatsApp chat's own number", () => {
    expect(crmPhoneOf({ platform: "whatsapp", phone: "919876543210", lead_phone: null })).toBe("919876543210");
  });
  it("uses a number a web-chat or Instagram lead shared", () => {
    expect(crmPhoneOf({ platform: "webchat", phone: "web:abc", lead_phone: "919876543210" })).toBe("919876543210");
    expect(crmPhoneOf({ platform: "instagram", phone: "ig:1", lead_phone: "919876543210", labels: [] })).toBe("919876543210");
  });
  it("never uses an unverified web-chat claim", () => {
    expect(crmPhoneOf({ platform: "webchat", phone: "web:abc", lead_phone: "919876543210", labels: [UNVERIFIED_PHONE_LABEL] })).toBeNull();
  });
});
