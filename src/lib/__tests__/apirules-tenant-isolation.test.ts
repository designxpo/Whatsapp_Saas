import { describe, it, expect, vi } from "vitest";

// Regression for a cross-tenant credential-abuse hole: saveRule() persisted
// input.channelId verbatim with no check that the channel belonged to the
// caller's tenant, and drainRuleSends() resolved that channel with credsFor()
// but no tenantId — so a rule pointed at another workspace's WhatsApp number
// sent through THAT number using ITS decrypted Meta token, on this tenant's
// event. See broadcast.ts's identical channelId check, which this now mirrors.

const OWNER_TENANT = "11111111-1111-1111-1111-111111111111";
const ATTACKER_TENANT = "22222222-2222-2222-2222-222222222222";
const FOREIGN_CHANNEL_ID = "channel-owned-by-owner-tenant";

// A tenant-aware stand-in for the real getChannel(id, tenantId): returns the
// channel ONLY when the tenantId matches its owner — exactly what a correct
// caller depends on, and exactly what the vulnerable call sites omitted.
const channels = new Map<string, { id: string; tenantId: string; token: string }>([
  [FOREIGN_CHANNEL_ID, { id: FOREIGN_CHANNEL_ID, tenantId: OWNER_TENANT, token: "owner-secret-meta-token" }],
]);
const getChannelCalls: { id: string; tenantId?: string }[] = [];

vi.mock("@/lib/channels", () => ({
  getChannel: async (id: string, tenantId?: string) => {
    getChannelCalls.push({ id, tenantId });
    const ch = channels.get(id);
    if (!ch) return null;
    if (tenantId && ch.tenantId !== tenantId) return null;   // the tenant-scoping the bug skipped
    return ch;
  },
  credsFor: vi.fn(async (ref: unknown, tenantId?: string) => {
    if (!ref) return undefined;
    const id = typeof ref === "string" ? ref : (ref as { id: string }).id;
    const ch = channels.get(id);
    if (!ch) return undefined;
    if (tenantId && ch.tenantId !== tenantId) return undefined;
    return { token: ch.token, phoneId: "p", wabaId: "w" };
  }),
}));
vi.mock("@/lib/whatsapp", () => ({
  fetchTemplates: async () => [],
  sendCampaign: vi.fn(async () => ({ sentCount: 0, skippedCount: 0, errors: ["not reached"] })),
  dynamicUrlButtonIndexes: () => [],
}));
vi.mock("@/lib/links", () => ({ getTrackedUrls: async () => [] }));
vi.mock("@/lib/quota", () => ({ getDailyCap: async () => 1000 }));
vi.mock("@/lib/store", () => ({
  createCampaign: async () => ({ id: "campaign-1" }),
  getContactByPhone: async () => null,
  dailySentCount: async () => 0,
}));
// Minimal insert stub — just enough for saveRule's own wa_api_rules write.
// The point of these tests is the ownership check upstream of it, not the
// persistence layer, which is covered elsewhere. Counted so the rejection
// tests can assert the guard fires BEFORE any write is attempted.
let dbCalls = 0;
vi.mock("@/lib/supabase", () => ({
  db: () => {
    dbCalls++;
    return {
      from: () => ({
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({ data: { id: "rule-1", created_at: new Date().toISOString(), ...row }, error: null }),
          }),
        }),
      }),
    };
  },
}));

import { saveRule, RuleConfigError } from "@/lib/apirules";

describe("saveRule — cross-tenant channel ownership", () => {
  it("rejects a channelId that belongs to a different tenant, before writing anything", async () => {
    dbCalls = 0;
    await expect(
      saveRule(
        { name: "steal", eventKey: "order_placed", templateName: "hello_world", channelId: FOREIGN_CHANNEL_ID },
        ATTACKER_TENANT,
      ),
    ).rejects.toThrow(RuleConfigError);
    expect(dbCalls).toBe(0);   // the rule (and the foreign channel_id) must never reach the database
  });

  it("checked ownership with the CALLER's tenant, not the channel's own", async () => {
    getChannelCalls.length = 0;
    await saveRule(
      { name: "steal", eventKey: "order_placed", templateName: "hello_world", channelId: FOREIGN_CHANNEL_ID },
      ATTACKER_TENANT,
    ).catch(() => {});
    expect(getChannelCalls).toContainEqual({ id: FOREIGN_CHANNEL_ID, tenantId: ATTACKER_TENANT });
  });

  it("accepts a channelId that genuinely belongs to the caller's tenant", async () => {
    const rule = await saveRule(
      { name: "legit", eventKey: "order_placed", templateName: "hello_world", channelId: FOREIGN_CHANNEL_ID },
      OWNER_TENANT,
    );
    expect(rule.channelId).toBe(FOREIGN_CHANNEL_ID);
  });

  it("allows saving a rule with no channelId at all (falls back to the tenant's default channel elsewhere)", async () => {
    const rule = await saveRule(
      { name: "no channel pinned", eventKey: "order_placed", templateName: "hello_world" },
      ATTACKER_TENANT,
    );
    expect(rule.channelId).toBeNull();
  });
});
