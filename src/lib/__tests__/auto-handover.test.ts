// Auto hand-over: a customer writing to a counsellor's OWN line moves the lead
// to that counsellor.
//
// This deliberately re-opens something that was closed for a good reason.
// Ownership is sticky because overwriting channel_id on every inbound sent one
// counsellor's portal reply out through whichever colleague's number the
// customer had written to most recently. So the tests here are mostly about the
// cases that must STILL NOT move, not the one that does.
//
// The discriminator is the arriving number's MODE, never recency: a `manual`
// channel is a 1:1 counsellor line, and a shared line (Organic, PPC SM, an API
// number) can never claim a lead. That is what keeps the old bug dead.
//
// It also matters for correctness, not just tidiness. Meta's 24-hour window is
// per-NUMBER while a portal reply leaves from the OWNER — so with a lead stuck
// on PPC SM while the customer writes to Divesh, replies went out from a number
// with no open conversation with them at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  reassigns: [] as { id: string; channelId: string }[],
  trail: [] as { by: string; reason: string | null }[],
  updateFails: false,
}));

// Mock at the DATABASE, not the function. reassignConversationChannel is called
// from inside store.ts, so a vi.spyOn of the module export never intercepts it —
// the module holds its own local reference.
vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "wa_conversations") {
        return {
          // Tenant-scoped (.eq tenant_id) AND by id, so the chain takes both and
          // resolves only when awaited.
          update: (patch: Record<string, unknown>) => {
            let id = "";
            const u: Record<string, unknown> = {
              eq: (c: string, v: string) => { if (c === "id") id = v; return u; },
              then: (res: (x: { error: unknown }) => unknown) => {
                if (h.updateFails) return Promise.resolve(res({ error: { message: "db down" } }));
                h.reassigns.push({ id, channelId: patch.channel_id as string });
                return Promise.resolve(res({ error: null }));
              },
            };
            return u;
          },
        };
      }
      // wa_conversation_owner_history — the trail insert
      return {
        insert: (row: Record<string, unknown>) => ({
          then: (ok: () => void) => { h.trail.push({ by: row.changed_by as string, reason: (row.reason as string) ?? null }); ok(); return Promise.resolve(); },
        }),
      };
    },
  }),
}));

beforeEach(() => { vi.resetModules(); h.reassigns = []; h.trail = []; h.updateFails = false; });

const load = () => import("../store");

const conv = (over: Record<string, unknown> = {}) => ({
  id: "conv-1", phone: "917302094184", name: "Kuldeep Singh",
  channelId: "ch-ppc", platform: "whatsapp", status: "active", botEnabled: false,
  ...over,
} as never);

const counsellor = { id: "ch-divesh", mode: "manual", name: "Divesh" };
const shared = { id: "ch-ppc-sm", mode: "full", name: "PPC SM" };

describe("moves the lead", () => {
  it("hands over when the customer writes to a counsellor's own line", async () => {
    const { autoHandoverToCounselorLine: run } = await load();
    const out = await run(conv(), counsellor);
    expect(out.channelId).toBe("ch-divesh");
    expect(h.reassigns).toEqual([{ id: "conv-1", channelId: "ch-divesh" }]);
    expect(h.trail[0].by).toBe("system");
    expect(h.trail[0].reason).toContain("Divesh");
  });

  it("returns the UPDATED conversation so a reply in the same request uses the new owner", async () => {
    // The webhook composes a reply after this call. Returning the stale object
    // would send from the old number — the exact failure being fixed.
    const { autoHandoverToCounselorLine: run } = await load();
    const out = await run(conv({ channelId: "ch-ppc" }), counsellor);
    expect(out.channelId).toBe("ch-divesh");
  });
});

describe("leaves the lead alone — the cases the old bug got wrong", () => {
  it("a SHARED line never claims a lead", async () => {
    // A broadcast reply landing on the marketing number must not pull the lead
    // away from the counsellor working it. This is the whole safety property.
    const { autoHandoverToCounselorLine: run } = await load();
    const out = await run(conv({ channelId: "ch-divesh" }), shared);
    expect(out.channelId).toBe("ch-divesh");
    expect(h.reassigns).toHaveLength(0);
  });

  it("does nothing when the counsellor line is already the owner", async () => {
    const { autoHandoverToCounselorLine: run } = await load();
    await run(conv({ channelId: "ch-divesh" }), counsellor);
    expect(h.reassigns).toHaveLength(0);
  });

  it("does not treat filling in an UNKNOWN owner as a hand-over", async () => {
    // getOrCreateConversation already fills a null channel_id and logs it as
    // "first known number". Logging a hand-over too would double up the trail.
    const { autoHandoverToCounselorLine: run } = await load();
    await run(conv({ channelId: null }), counsellor);
    expect(h.reassigns).toHaveLength(0);
  });

  it("ignores an unknown / env-era arriving number", async () => {
    const { autoHandoverToCounselorLine: run } = await load();
    await run(conv(), null);
    await run(conv(), undefined);
    expect(h.reassigns).toHaveLength(0);
  });

  it("leaves Instagram and Messenger threads sticky — counsellor lines are a WhatsApp idea", async () => {
    const { autoHandoverToCounselorLine: run } = await load();
    await run(conv({ platform: "instagram" }), counsellor);
    await run(conv({ platform: "messenger" }), counsellor);
    expect(h.reassigns).toHaveLength(0);
  });

  it("treats a missing mode as shared, not as a counsellor line", async () => {
    // A channel row saved before `mode` existed reads as undefined. Defaulting
    // that to "counsellor" would hand leads to shared numbers.
    const { autoHandoverToCounselorLine: run } = await load();
    await run(conv(), { id: "ch-x", mode: null, name: "Legacy" });
    await run(conv(), { id: "ch-y", name: "No mode field" });
    expect(h.reassigns).toHaveLength(0);
  });
});

describe("never costs an inbound message", () => {
  it("swallows a reassign failure and returns the original conversation", async () => {
    // This runs mid-webhook, before the message is logged. Throwing here would
    // drop a real customer message on the floor to fix a bookkeeping detail.
    const { autoHandoverToCounselorLine: run } = await load();
    h.updateFails = true;
    const out = await run(conv(), counsellor);
    expect(out.channelId).toBe("ch-ppc");
    expect(h.reassigns).toHaveLength(0);
  });
});
