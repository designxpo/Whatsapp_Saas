import { describe, it, expect } from "vitest";
import { pickResult } from "../ads";

// pickResult maps a campaign/ad-set's intent + Meta's flat `actions` array to the
// ONE result Meta counts (matching Ads Manager's "Results" column). The portal
// used to surface only WhatsApp chats, so lead-form campaigns read "0 chats" and
// looked frozen. These action arrays are the REAL ones pulled from the live
// account during diagnosis.
const A = (pairs: [string, number][]) => pairs.map(([action_type, v]) => ({ action_type, value: String(v) }));

describe("pickResult", () => {
  it("LEADS campaign optimized for registration → Registrations (not the raw lead count)", () => {
    const acts = A([["complete_registration", 424], ["lead", 615], ["onsite_web_lead", 615], ["landing_page_view", 954], ["link_click", 1347]]);
    expect(pickResult("OUTCOME_LEADS", acts)).toEqual({ count: 424, label: "Registrations" });
  });

  it("LEADS campaign with only leads → Leads", () => {
    const acts = A([["link_click", 2650], ["landing_page_view", 1234], ["onsite_web_lead", 139], ["lead", 139]]);
    expect(pickResult("OUTCOME_LEADS", acts)).toEqual({ count: 139, label: "Leads" });
  });

  it("LEADS campaign with no lead actions this window → 0 Leads (matches Meta's 0, not a stray click count)", () => {
    const acts = A([["link_click", 42], ["landing_page_view", 16], ["post_engagement", 47]]);
    expect(pickResult("OUTCOME_LEADS", acts)).toEqual({ count: 0, label: "Leads" });
  });

  it("TRAFFIC campaign → Landing views", () => {
    const acts = A([["link_click", 4172], ["landing_page_view", 2090], ["onsite_conversion.messaging_conversation_started_7d", 1]]);
    expect(pickResult("OUTCOME_TRAFFIC", acts)).toEqual({ count: 2090, label: "Landing views" });
  });

  it("messaging / CTWA → Chats (matches the _7d-suffixed action)", () => {
    const acts = A([["onsite_conversion.messaging_conversation_started_7d", 12], ["link_click", 40]]);
    expect(pickResult("OUTCOME_ENGAGEMENT", acts)).toEqual({ count: 12, label: "Chats" });
  });

  it("ad-set optimization goal works as the hint too", () => {
    expect(pickResult("LEAD_GENERATION", A([["onsite_web_lead", 7]]))).toEqual({ count: 7, label: "Leads" });
    expect(pickResult("LANDING_PAGE_VIEWS", A([["landing_page_view", 30]]))).toEqual({ count: 30, label: "Landing views" });
  });

  it("unknown intent surfaces the richest real conversion present", () => {
    expect(pickResult("", A([["link_click", 100], ["lead", 5]]))).toEqual({ count: 5, label: "Leads" });
    expect(pickResult("", A([["link_click", 100]]))).toEqual({ count: 100, label: "Link clicks" });
  });

  it("no usable actions → 0 Results, never throws", () => {
    expect(pickResult("OUTCOME_AWARENESS", [])).toEqual({ count: 0, label: "Results" });
  });
});
