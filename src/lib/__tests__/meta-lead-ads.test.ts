// Meta Lead Ads: a signed Page "leadgen" webhook becomes a contact (with its
// ad), a CRM lead, and the meta_lead_ads.lead event a message rule can greet
// on WhatsApp — once per lead, only for the business that owns the Page.
// Shapes follow Meta's documented leadgen webhook; values are synthetic.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const h = vi.hoisted(() => ({
  claimed: new Set<string>(),
  contacts: [] as Record<string, unknown>[],
  events: [] as { event: string; phone: string; name?: string; payload: Record<string, unknown>; tenant: string }[],
  lead: { phone: "919876500041", fullName: "Rohit Verma", email: "rohit@example.com", city: "Pune", formId: "form_9" } as Record<string, string | undefined> | null,
}));

vi.mock("next/server", async orig => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock("@/lib/partner-meta", () => ({ verifyPartnerWebhook: async () => false, partnerVerifyTokenOk: async () => false, partnerScope: async () => null }));
vi.mock("@/lib/channels", () => ({
  getChannelByPageId: async (id: string) => (id === "page_1" ? { id: "ch-fb", tenantId: "tenant-a", kind: "messenger", pageId: "page_1", token: "page-token", active: true } : null),
  effectiveAgentId: () => null, effectiveKbScope: () => null,
}));
vi.mock("@/lib/store", () => ({
  claimWebhookEvent: async (k: string) => (h.claimed.has(k) ? false : (h.claimed.add(k), true)),
  upsertContacts: async (rows: Record<string, unknown>[]) => { h.contacts.push(...rows); },
}));
vi.mock("@/lib/ads", () => ({ fetchLeadgen: async () => h.lead }));
vi.mock("@/lib/leadsquared", () => ({ createOrUpdateLead: async () => undefined, pushChatActivity: async () => undefined, phoneFromAttributes: () => null, extractPhone: () => null }));
vi.mock("@/lib/apirules", () => ({ processEvent: async (p: { event: string; phone: string; name?: string; payload: Record<string, unknown> }, tenant: string) => { h.events.push({ ...p, tenant }); return []; } }));
vi.mock("@/lib/cronwatchdog", () => ({ kickIfStalled: () => undefined }));

const SECRET = "meta-app-secret-for-tests";
process.env.META_APP_SECRET = SECRET;
const { POST } = await import("../../app/api/webhooks/messenger/route");

const send = (body: unknown, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return POST(new Request("http://x/api/webhooks/messenger", { method: "POST", body: raw, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` } }));
};
const leadgen = (page: string, id: string) => ({ object: "page", entry: [{ id: page, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: id, page_id: page, form_id: "form_9", ad_id: "ad_77", adgroup_id: "as_1", created_time: 1762409400 } }] }] });

beforeEach(() => { h.claimed = new Set(); h.contacts = []; h.events = []; });

describe("Meta Lead Ads webhook", () => {
  it("saves the lead with its ad and raises the event a WhatsApp greeting rule listens for, once", async () => {
    await send(leadgen("page_1", "lead_1"));
    await send(leadgen("page_1", "lead_1"));     // Meta redelivers
    expect(h.contacts).toEqual([expect.objectContaining({ phone: "919876500041", name: "Rohit Verma", email: "rohit@example.com", attributes: expect.objectContaining({ ad_id: "ad_77", meta_form_id: "form_9", source: "Meta Lead Ad" }) })]);
    expect(h.events).toEqual([{ event: "meta_lead_ads.lead", phone: "919876500041", name: "Rohit Verma", tenant: "tenant-a", payload: { form_id: "form_9", ad_id: "ad_77", email: "rohit@example.com", city: "Pune", leadgen_id: "lead_1" } }]);
  });

  it("ignores a lead without a phone, a Page nobody connected, and an unsigned delivery", async () => {
    h.lead = { fullName: "No Phone", formId: "form_9" };
    await send(leadgen("page_1", "lead_2"));
    h.lead = { phone: "919876500042", formId: "form_9" };
    await send(leadgen("page_unknown", "lead_3"));
    const bad = await send(leadgen("page_1", "lead_4"), "wrong-secret");
    expect(bad.status).toBe(401);
    expect(h.contacts).toEqual([]);
    expect(h.events).toEqual([]);
  });
});
