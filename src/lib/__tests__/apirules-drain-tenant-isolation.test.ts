import { describe, it, expect, vi } from "vitest";

// Regression, send-time half: even with saveRule's ownership check in place,
// a rule's channel_id can still point at a foreign channel — a rule saved
// before that fix existed, or a channel deleted/reassigned afterwards.
// drainRuleSends must independently resolve credentials scoped to the RULE's
// own tenant, not whatever tenant the referenced channel happens to belong to.

const OWNER_TENANT = "11111111-1111-1111-1111-111111111111";
const ATTACKER_TENANT = "22222222-2222-2222-2222-222222222222";
const FOREIGN_CHANNEL_ID = "channel-owned-by-owner-tenant";

const channels = new Map([[FOREIGN_CHANNEL_ID, { id: FOREIGN_CHANNEL_ID, tenantId: OWNER_TENANT, token: "owner-secret-meta-token" }]]);

vi.mock("@/lib/channels", () => ({
  credsFor: vi.fn(async (ref: unknown, tenantId?: string) => {
    if (!ref) return undefined;
    const id = typeof ref === "string" ? ref : (ref as { id: string }).id;
    const ch = channels.get(id);
    if (!ch) return undefined;
    // The tenant-scoping the vulnerable call site omitted entirely.
    if (tenantId && ch.tenantId !== tenantId) return undefined;
    return { token: ch.token, phoneId: "p", wabaId: "w" };
  }),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendCampaign: vi.fn(async () => ({ sentCount: 0, skippedCount: 0, errors: ["credentials withheld — not this tenant's channel"] })),
  fetchTemplates: async () => [],
  dynamicUrlButtonIndexes: () => [],
}));
vi.mock("@/lib/links", () => ({ getTrackedUrls: async () => [] }));
vi.mock("@/lib/quota", () => ({ getDailyCap: async () => 1000 }));
vi.mock("@/lib/store", () => ({
  createCampaign: async () => ({ id: "campaign-1" }),
  getContactByPhone: async () => null,
  dailySentCount: async () => 0,
}));

// The rule references a channel owned by a DIFFERENT tenant than the rule
// itself — exactly the state a pre-fix saveRule call, or a later channel
// reassignment, could leave behind. drainRuleSends must not trust it.
const PENDING_SEND = {
  id: "send-1", rule_id: "rule-x", status: "pending",
  send_after: new Date(Date.now() - 1000).toISOString(),
  variables: [], phone: "919876543210", recipient_name: "Asha", button_url_params: [],
};
const RULE_ROW = {
  id: "rule-x", tenant_id: ATTACKER_TENANT, channel_id: FOREIGN_CHANNEL_ID, active: true,
  template_name: "hello_world", language_code: "en_US", variables: [], header_image_url: null,
  button_url_params: [], delay_value: 0, delay_unit: "minutes", window_start_hour: null, window_end_hour: null,
  frequency_cap_hours: 0, campaign_id: "campaign-1", created_at: new Date().toISOString(),
};

vi.mock("@/lib/supabase", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "wa_rule_sends") {
        return {
          // The initial "what's due" read.
          select: () => ({ eq: () => ({ lte: () => ({ order: () => ({ limit: async () => ({ data: [PENDING_SEND] }) }) }) }) }),
          // The atomic claim (update … .eq(status,pending).select("id")) and the
          // final status write both go through here; either shape just needs to
          // resolve without throwing for this test.
          update: () => ({
            eq: () => ({
              eq: () => ({ select: async () => ({ data: [{ id: "send-1" }] }) }),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null })),
            }),
          }),
        };
      }
      if (table === "wa_api_rules") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: RULE_ROW }) }) }) };
      }
      return { select: () => ({ eq: () => ({}) }) };
    },
  }),
}));

import { credsFor } from "@/lib/channels";
import { drainRuleSends } from "@/lib/apirules";

describe("drainRuleSends — resolves credentials scoped to the rule's OWN tenant", () => {
  it("passes the rule's tenantId into credsFor for the foreign channel, and gets nothing back", async () => {
    const spy = vi.mocked(credsFor);
    spy.mockClear();

    await drainRuleSends(10);

    const callsForForeignChannel = spy.mock.calls.filter(([ref]) => ref === FOREIGN_CHANNEL_ID);
    expect(callsForForeignChannel.length).toBeGreaterThan(0);
    for (const call of callsForForeignChannel) {
      // The fix: tenantId is supplied, and it's the RULE's tenant (the attacker),
      // not the channel's own — so credsFor's tenant check correctly refuses,
      // and the owner's decrypted Meta token is never handed back.
      expect(call[1]).toBe(ATTACKER_TENANT);
    }
    // The actual resolved value for every one of those calls must be undefined —
    // proof the owner's token was withheld, not merely that a tenantId was passed.
    const results = await Promise.all(callsForForeignChannel.map(c => credsFor(c[0], c[1])));
    for (const r of results) expect(r).toBeUndefined();
  });
});
