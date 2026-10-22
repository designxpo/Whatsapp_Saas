import { describe, it, expect, vi, beforeEach } from "vitest";

// The daily digest: one email a business morning to a workspace's admins and
// owner — chats waiting on a reply and which number they sit on, escalations
// nobody picked up, and yesterday's leads, AI replies, opt-outs and failed
// sends. The weekly recap says how the week went; this says what is waiting.
//
// Off until a workspace's admin switches it on; claimed once per business day
// per workspace (claimTenantSettingOnce) and released if the send fails, the
// same pattern as the weekly recap; and an unsubscribe link turns it off.

const h = vi.hoisted(() => ({
  settings: {} as Record<string, Record<string, unknown>>,
  claims: new Set<string>(),
  released: [] as string[],
  users: {} as Record<string, { email: string; role: string; active: boolean }[]>,
  tenants: [] as { id: string; owner_email: string | null; status: string }[],
  unsub: new Set<string>(),
  sent: [] as { to: string; subject: string; tenantId?: string }[],
  sendOk: true,
}));

vi.mock("../store", () => ({
  getTenantSetting: async (t: string, k: string, d: unknown) => (h.settings[t] && k in h.settings[t] ? h.settings[t][k] : d),
  setTenantSetting: async (t: string, k: string, v: unknown) => { (h.settings[t] ??= {})[k] = v; },
  tenantIdsWithSetting: async (k: string, on: (v: unknown) => boolean) =>
    Object.entries(h.settings).filter(([, s]) => k in s && on(s[k])).map(([t]) => t),
  claimTenantSettingOnce: async (t: string, k: string) => { const key = `${t}:${k}`; if (h.claims.has(key)) return false; h.claims.add(key); return true; },
  releaseTenantSetting: async (t: string, k: string) => { h.claims.delete(`${t}:${k}`); h.released.push(`${t}:${k}`); },
}));
vi.mock("../team", () => ({ listUsers: async (t: string) => h.users[t] ?? [] }));
vi.mock("../email", () => ({
  sendEmail: async (m: { to: string; subject: string; tenantId?: string }) => { h.sent.push(m); return { ok: h.sendOk }; },
}));
vi.mock("../emailprefs", () => ({
  isUnsubscribed: async (t: string) => h.unsub.has(t),
  setUnsubscribed: async (t: string, _k: string, v: boolean) => { if (v) h.unsub.add(t); else h.unsub.delete(t); },
  unsubscribeUrl: (t: string) => `https://x/unsub/${t}`,
}));
vi.mock("../llm", () => ({ generateExecutiveBrief: async () => { throw new Error("AiKeyMissingError"); } }));
vi.mock("../supabase", () => ({
  db: () => ({
    from: () => {
      const st: { ids?: string[] } = {};
      const o: Record<string, unknown> = {
        select: () => o,
        in: (col: string, v: string[]) => { if (col === "id") st.ids = v; return o; },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: h.tenants.filter(t => (!st.ids || st.ids.includes(t.id)) && ["trialing", "active"].includes(t.status)), error: null }).then(res),
      };
      return o;
    },
  }),
}));

const NUMBERS = {
  day: "2026-10-21",
  waiting: { total: 12, oldestHours: 30, byOwner: [{ name: "Main line", count: 12 }] },
  escalatedStale: 2,
  yesterday: { newLeads: 5, aiReplies: 40, escalations: 1, optOuts: 0, failedSends: 0 },
  inDrips: 9,
};
vi.mock("../digestdata", () => ({ gatherDigest: async () => NUMBERS }));

const { digestDue, drainDailyDigests, sendDigestNow, setDigestConfig } = await import("../dailydigest");

const MORNING = Date.parse("2026-10-22T04:30:00Z");   // 10:00 IST
const EARLY = Date.parse("2026-10-22T01:30:00Z");     // 07:00 IST

beforeEach(() => {
  h.settings = { t1: { daily_digest: { enabled: true, hour: 9 } }, t2: { daily_digest: { enabled: false, hour: 9 } } };
  h.claims = new Set(); h.released = []; h.unsub = new Set(); h.sent = []; h.sendOk = true;
  h.tenants = [
    { id: "t1", owner_email: "owner@one.co", status: "active" },
    { id: "t2", owner_email: "owner@two.co", status: "active" },
  ];
  h.users = {
    t1: [
      { email: "admin@one.co", role: "admin", active: true },
      { email: "OWNER@one.co", role: "admin", active: true },
      { email: "member@one.co", role: "member", active: true },
    ],
    t2: [{ email: "admin@two.co", role: "admin", active: true }],
  };
});

describe("digestDue", () => {
  it("is due once the business-day hour has passed", () => {
    expect(digestDue({ enabled: true, hour: 9 }, MORNING)).toBe(true);
    expect(digestDue({ enabled: true, hour: 9 }, EARLY)).toBe(false);
    expect(digestDue({ enabled: false, hour: 9 }, MORNING)).toBe(false);
  });
});

describe("drainDailyDigests", () => {
  it("sends only to workspaces that switched it on — to their admins and owner, once each", async () => {
    const r = await drainDailyDigests(MORNING);
    expect(r).toEqual({ tenants: 1, sent: 2 });
    expect(h.sent.map(s => s.to).sort()).toEqual(["admin@one.co", "owner@one.co"]);
    expect(h.sent.every(s => s.tenantId === "t1")).toBe(true);
  });

  it("sends once per business day, and records the day for the settings card", async () => {
    await drainDailyDigests(MORNING);
    await drainDailyDigests(MORNING + 60_000);
    expect(h.sent).toHaveLength(2);
    expect(h.settings.t1.daily_digest_last_day).toBe("2026-10-22");
  });

  it("releases the day when nothing was delivered, so a later tick retries", async () => {
    h.sendOk = false;
    await drainDailyDigests(MORNING);
    expect(h.released).toEqual(["t1:daily_digest:2026-10-22"]);
  });

  it("respects an unsubscribe", async () => {
    h.unsub.add("t1");
    expect((await drainDailyDigests(MORNING)).sent).toBe(0);
  });

  it("waits for the hour", async () => {
    expect((await drainDailyDigests(EARLY)).sent).toBe(0);
  });
});

describe("sendDigestNow", () => {
  it("sends the test without using up the day", async () => {
    h.settings.t1.daily_digest = { enabled: false, hour: 9 };
    const r = await sendDigestNow("t1", EARLY);
    expect(r.sent).toBe(2);
    expect(h.claims.size).toBe(0);
  });
});

describe("setDigestConfig", () => {
  it("switching on clears an earlier unsubscribe, and rejects a bad hour", async () => {
    h.unsub.add("t2");
    await setDigestConfig("t2", { enabled: true });
    expect(h.unsub.has("t2")).toBe(false);
    await expect(setDigestConfig("t2", { hour: 25 })).rejects.toThrow();
  });
});
