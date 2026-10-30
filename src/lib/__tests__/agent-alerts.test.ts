// Agent alerts: which chats count as waiting for a person, who hears about
// them, and that each new message is announced once (src/lib/use-inbox-alerts.ts,
// waitingForTeam in store.ts). Names and numbers are synthetic.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ queries: [] as { calls: [string, unknown[]][] }[] }));

vi.mock("../supabase", () => ({
  db: () => ({
    from: () => {
      const q = { calls: [] as [string, unknown[]][] };
      h.queries.push(q);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "or", "order", "limit"]) {
        chain[m] = (...args: unknown[]) => { q.calls.push([m, args]); return chain; };
      }
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({
        count: 2,
        data: [{ id: "c1", name: "Asha", phone: "919876500001", platform: "whatsapp", last_message: "fees?", last_inbound_at: "2026-10-30T09:55:00Z", status: "escalated", bot_enabled: true }],
      }).then(res);
      return chain;
    },
  }),
  serviceDb: () => ({}),
}));

const { waitingForTeam, UNANSWERED_AFTER_MS } = await import("../store");
const { freshChats, titleWithCount } = await import("../use-inbox-alerts");

const NOW = Date.parse("2026-10-30T10:00:00Z");
const callsOf = (i: number, m: string) => h.queries[i].calls.filter(([n]) => n === m).map(([, a]) => a);

beforeEach(() => { h.queries = []; });

describe("waiting for a person", () => {
  it("counts only one business's chats a person must answer — handed over, taken over, or unanswered for 2 minutes", async () => {
    const r = await waitingForTeam({ tenantId: "t-acme", channelIds: null, aiOn: true, now: NOW });
    expect(r.count).toBe(2);
    expect(r.chats[0]).toMatchObject({ id: "c1", reason: "escalated", preview: "fees?" });
    for (const i of [0, 1]) {
      expect(callsOf(i, "eq")).toContainEqual(["needs_reply", true]);
      expect(callsOf(i, "eq")).toContainEqual(["tenant_id", "t-acme"]);   // the service client: this filter IS the isolation
      expect(callsOf(i, "or")[0][0]).toBe(`status.eq.escalated,bot_enabled.eq.false,last_inbound_at.lte."${new Date(NOW - UNANSWERED_AFTER_MS).toISOString()}"`);
      expect(callsOf(i, "gte")).toContainEqual(["last_inbound_at", new Date(NOW - 24 * 3600_000).toISOString()]);
    }
  });

  it("with the AI off, every chat that needs a reply needs a person", async () => {
    await waitingForTeam({ tenantId: "t-acme", channelIds: null, aiOn: false, now: NOW });
    expect(callsOf(0, "or")).toEqual([]);
  });

  it("a team member hears only about their own team's numbers", async () => {
    await waitingForTeam({ tenantId: "t-acme", channelIds: ["ch-sales-1", "ch-sales-2"], aiOn: true, now: NOW });
    expect(callsOf(0, "in")).toContainEqual(["channel_id", ["ch-sales-1", "ch-sales-2"]]);
    expect(callsOf(1, "in")).toContainEqual(["channel_id", ["ch-sales-1", "ch-sales-2"]]);
  });

  it("someone scoped to no numbers hears nothing — without asking the database", async () => {
    expect(await waitingForTeam({ tenantId: "t-acme", channelIds: [], aiOn: true, now: NOW })).toEqual({ count: 0, chats: [] });
    expect(h.queries).toEqual([]);
  });
});

describe("announcing", () => {
  const chat = (id: string, at: string) => ({ id, name: "", phone: "9198", platform: "whatsapp" as const, preview: "", lastInboundAt: at, reason: "unanswered" as const });

  it("announces each new message once, and a new message in the same chat again", () => {
    const seen = new Set(["c1@2026-10-30T09:00:00Z"]);
    expect(freshChats([chat("c1", "2026-10-30T09:00:00Z")], seen)).toEqual([]);
    expect(freshChats([chat("c1", "2026-10-30T09:05:00Z")], seen).map(c => c.id)).toEqual(["c1"]);
    expect(freshChats([chat("c2", "2026-10-30T09:00:00Z")], seen).map(c => c.id)).toEqual(["c2"]);
  });

  it("puts the count in the tab title, and takes it off again", () => {
    expect(titleWithCount("Mindbird", 3)).toBe("(3) Mindbird");
    expect(titleWithCount("(3) Mindbird", 5)).toBe("(5) Mindbird");
    expect(titleWithCount("(5) Mindbird", 0)).toBe("Mindbird");
    expect(titleWithCount("Mindbird", 250)).toBe("(99+) Mindbird");
  });
});
