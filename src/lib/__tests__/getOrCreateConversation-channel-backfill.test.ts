import { describe, it, expect, vi } from "vitest";

// A DM/comment conversation that was created with no channel_id (a resolution
// miss during a reconnect, or a channel that's since been repaired/replaced)
// stayed channel-less forever: getOrCreateConversation only re-anchored
// channel_id for WhatsApp, so every later inbound on that Instagram/Messenger
// thread kept finding the row, seeing channel_id was already "set" (to null,
// which passed the `!==` check) and silently declining to fill it in. That
// left the thread permanently outside per-channel persona/KB scoping and any
// channel-specific automation, with nothing in the portal ever surfacing it.
//
// The fix must ALSO not regress the documented anti-bleed behaviour: an IG
// conversation that already has a channel_id must never be re-pointed at a
// different one just because a later webhook named a different channel.

const TENANT = "tenant-1";

function makeDbStub(existingRow: Record<string, unknown> | null) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const db = () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: existingRow }) }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
  });
  return { db, updates };
}

describe("getOrCreateConversation — channel_id backfill for non-WhatsApp platforms", () => {
  it("backfills a NULL channel_id on an Instagram conversation", async () => {
    vi.resetModules();
    const { db, updates } = makeDbStub({ id: "conv-1", tenant_id: TENANT, phone: "igsid-1", platform: "instagram", channel_id: null, name: "" });
    vi.doMock("../supabase", () => ({ db }));
    vi.doMock("../tenantdb", () => ({ tdb: () => ({}) }));
    vi.doMock("../crypto", () => ({ encryptSecret: (v: string) => v, readSecret: (v: string) => v }));
    vi.doMock("../moderation", () => ({ assertTextAllowed: async () => {} }));
    const { getOrCreateConversation } = await import("../store");

    const conv = await getOrCreateConversation("igsid-1", "@handle", "channel-new", "instagram", TENANT);

    const channelPatch = updates.find(u => "channel_id" in u.patch);
    expect(channelPatch?.patch.channel_id).toBe("channel-new");
    expect(conv.channelId).toBe("channel-new");
  });

  it("does NOT re-point an Instagram conversation that already has a DIFFERENT channel_id", async () => {
    vi.resetModules();
    const { db, updates } = makeDbStub({ id: "conv-2", tenant_id: TENANT, phone: "igsid-2", platform: "instagram", channel_id: "channel-original", name: "" });
    vi.doMock("../supabase", () => ({ db }));
    vi.doMock("../tenantdb", () => ({ tdb: () => ({}) }));
    vi.doMock("../crypto", () => ({ encryptSecret: (v: string) => v, readSecret: (v: string) => v }));
    vi.doMock("../moderation", () => ({ assertTextAllowed: async () => {} }));
    const { getOrCreateConversation } = await import("../store");

    const conv = await getOrCreateConversation("igsid-2", "@handle", "channel-different", "instagram", TENANT);

    const channelPatch = updates.find(u => "channel_id" in u.patch);
    expect(channelPatch).toBeUndefined();
    expect(conv.channelId).toBe("channel-original");
  });

  // WhatsApp used to be the one platform that DID follow the customer to their
  // last number, on the reasoning that a tenant's numbers are interchangeable
  // brand lines. That is no longer true, and this assertion is inverted from
  // what it originally checked: with coexistence a tenant runs one number per
  // counselor, so those numbers are personal identities — following the customer
  // sent one counselor's manual reply out through another counselor's number.
  // WhatsApp is now anchored like every other platform; only a deliberate
  // reassign moves ownership. See conv-owner-sticky.test.ts for the full contract.
  it("does NOT re-point a WhatsApp conversation that already has a DIFFERENT channel_id", async () => {
    vi.resetModules();
    const { db, updates } = makeDbStub({ id: "conv-3", tenant_id: TENANT, phone: "919876543210", platform: "whatsapp", channel_id: "old-number", name: "" });
    vi.doMock("../supabase", () => ({ db }));
    vi.doMock("../tenantdb", () => ({ tdb: () => ({}) }));
    vi.doMock("../crypto", () => ({ encryptSecret: (v: string) => v, readSecret: (v: string) => v }));
    vi.doMock("../moderation", () => ({ assertTextAllowed: async () => {} }));
    const { getOrCreateConversation } = await import("../store");

    const conv = await getOrCreateConversation("919876543210", "Asha", "new-number", "whatsapp", TENANT);

    const channelPatch = updates.find(u => "channel_id" in u.patch);
    expect(channelPatch).toBeUndefined();
    expect(conv.channelId).toBe("old-number");
  });

  it("still backfills a NULL channel_id on a WhatsApp conversation (orphaned row)", async () => {
    vi.resetModules();
    const { db, updates } = makeDbStub({ id: "conv-4", tenant_id: TENANT, phone: "919876543211", platform: "whatsapp", channel_id: null, name: "" });
    vi.doMock("../supabase", () => ({ db }));
    vi.doMock("../tenantdb", () => ({ tdb: () => ({}) }));
    vi.doMock("../crypto", () => ({ encryptSecret: (v: string) => v, readSecret: (v: string) => v }));
    vi.doMock("../moderation", () => ({ assertTextAllowed: async () => {} }));
    const { getOrCreateConversation } = await import("../store");

    const conv = await getOrCreateConversation("919876543211", "Asha", "first-number", "whatsapp", TENANT);

    const channelPatch = updates.find(u => "channel_id" in u.patch);
    expect(channelPatch?.patch.channel_id).toBe("first-number");
    expect(conv.channelId).toBe("first-number");
  });
});
