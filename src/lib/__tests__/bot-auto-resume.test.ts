// A chat's bot comes back on after the team has gone quiet, per workspace,
// answers only, and never starts a conversation by itself. Ids are synthetic.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rows: [] as Record<string, unknown>[],
  updates: [] as { patch: Record<string, unknown>; filters: [string, string, unknown][] }[],
  reads: [] as [string, string, unknown][][],
  channels: [] as { id: string; mode: string }[],
  offTenants: [] as string[],
  error: null as { message: string } | null,
}));

function query(tenantId: string | null) {
  const filters: [string, string, unknown][] = tenantId ? [["eq", "tenant_id", tenantId]] : [];
  let patch: Record<string, unknown> | null = null;
  let head = false;
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
    eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
    lte: (k: string, v: unknown) => { filters.push(["lte", k, v]); return q; },
    in: (k: string, v: unknown) => { filters.push(["in", k, v]); return q; },
    not: (k: string, op: string, v: unknown) => { filters.push(["not", k, `${op} ${v}`]); return q; },
    or: (v: string) => { filters.push(["or", "", v]); return q; },
    order: () => q, limit: () => q,
    update: (p: Record<string, unknown>) => { patch = p; return q; },
    then: (ok: (x: unknown) => unknown) => {
      if (h.error) return Promise.resolve(ok({ data: null, error: h.error, count: null }));
      if (patch) { h.updates.push({ patch, filters: [...filters] }); return Promise.resolve(ok({ data: h.rows.map(r => ({ id: r.id })), error: null })); }
      if (head) return Promise.resolve(ok({ count: 4, error: null }));
      h.reads.push([...filters]);
      return Promise.resolve(ok({ data: h.rows, error: null }));
    },
  };
  return q;
}
vi.mock("../supabase", () => ({ db: () => ({ from: () => query(null) }) }));
vi.mock("../tenantdb", () => ({ tdb: (t: string) => ({ from: () => ({ select: (c?: string, o?: { head?: boolean }) => (query(t).select as (c?: string, o?: { head?: boolean }) => unknown)(c, o), update: (p: Record<string, unknown>) => (query(t).update as (p: Record<string, unknown>) => unknown)(p) }) }) }));
vi.mock("../store", () => ({
  getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}:${k}` in h.settings ? h.settings[`${t}:${k}`] : d),
  setTenantSetting: async (t: string, k: string, v: unknown) => { h.settings[`${t}:${k}`] = v; },
  tenantIdsWithSetting: async () => h.offTenants,
}));
vi.mock("../channels", () => ({ listChannels: async () => h.channels }));
vi.mock("../team", () => ({ logActivity: () => undefined }));

const br = await import("../botresume");
const NOW = Date.parse("2026-11-05T12:00:00Z");
const HOUR = 3_600_000;
const ago = (hrs: number) => new Date(NOW - hrs * HOUR).toISOString();

beforeEach(() => { h.settings = {}; h.rows = []; h.updates = []; h.reads = []; h.channels = []; h.offTenants = []; h.error = null; });

describe("the setting, per workspace", () => {
  it("is on by default, after 12 hours", async () => {
    expect(await br.getBotResume("t-1")).toEqual({ enabled: true, afterHours: 12 });
  });
  it("keeps hours between 1 and 168", () => {
    expect([0, "x", 3, 999].map(br.clampHours)).toEqual([12, 12, 3, 168]);
  });
  it("one workspace switching it off doesn't affect another", async () => {
    await br.setBotResume("t-1", { enabled: false, afterHours: 5 });
    expect(await br.getBotResume("t-1")).toEqual({ enabled: false, afterHours: 5 });
    expect(await br.getBotResume("t-2")).toEqual({ enabled: true, afterHours: 12 });
    expect(await br.resumeTenantBots("t-1", NOW)).toEqual({ resumed: 0, reason: "disabled" });
  });
});

describe("which chats come back on", () => {
  const cutoff = NOW - 12 * HOUR;
  it("only when the bot has been off, and nothing sent, for longer than the setting", () => {
    expect(br.isDue({ bot_off_at: ago(13), last_outbound_at: ago(14), channel_id: "c" }, cutoff, new Set())).toBe(true);
    expect(br.isDue({ bot_off_at: ago(30), last_outbound_at: ago(1), channel_id: "c" }, cutoff, new Set())).toBe(false);
    expect(br.isDue({ bot_off_at: ago(2), last_outbound_at: null, channel_id: "c" }, cutoff, new Set())).toBe(false);
  });
  it("never a personal number, never an undated chat", () => {
    expect(br.isDue({ bot_off_at: ago(50), last_outbound_at: null, channel_id: "p" }, cutoff, new Set(["p"]))).toBe(false);
    expect(br.isDue({ bot_off_at: null, last_outbound_at: null, channel_id: "c" }, cutoff, new Set())).toBe(false);
  });
});

describe("a pass", () => {
  it("reads and writes only this workspace's chats, and only where the bot is still off", async () => {
    h.rows = [{ id: "c1", phone: "1", bot_off_at: ago(20), last_outbound_at: ago(20), channel_id: "ch" }];
    expect(await br.resumeTenantBots("t-1", NOW)).toEqual({ resumed: 1 });
    expect(h.reads[0]).toContainEqual(["eq", "tenant_id", "t-1"]);
    expect(h.updates[0].filters).toContainEqual(["eq", "tenant_id", "t-1"]);
    expect(h.updates[0].filters).toContainEqual(["eq", "bot_enabled", false]);
    expect(h.updates[0].patch).toMatchObject({ bot_enabled: true, bot_resumed_at: new Date(NOW).toISOString() });
  });
  it("the cron skips workspaces that switched it off", async () => {
    h.offTenants = ["t-off"];
    await br.drainBotResumes(NOW);
    expect(h.reads[0]).toContainEqual(["not", "tenant_id", "in (t-off)"]);
  });
  it("does nothing, without an error, before the migration", async () => {
    h.error = { message: "column bot_off_at does not exist" };
    expect(await br.resumeTenantBots("t-1", NOW)).toEqual({ resumed: 0, reason: "unavailable" });
    expect(await br.drainBotResumes(NOW)).toEqual({ tenants: 0, resumed: 0 });
  });
});

describe("a resumed bot answers, it never starts anything", () => {
  it("until the customer writes again", () => {
    expect(br.resumedQuiet({ bot_resumed_at: ago(1), last_inbound_at: ago(5) })).toBe(true);
    expect(br.resumedQuiet({ bot_resumed_at: ago(5), last_inbound_at: ago(1) })).toBe(false);
  });
  it("follow-ups and inactivity drips skip it; the cron and Settings carry it; the route fails closed", () => {
    const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
    expect(read("src/lib/followups.ts")).toMatch(/if \(resumedQuiet\(r as/);
    expect(read("src/lib/sequences.ts")).toMatch(/if \(resumedQuiet\(c as/);
    expect(read("src/app/api/cron/process-queue/route.ts")).toMatch(/drainBotResumes\(\)/);
    const tab = read("src/app/admin/_tabs/SettingsTab.tsx");
    const auto = tab.slice(tab.indexOf('{section === "automation" && (<>'), tab.indexOf('{section === "replies" && (<>'));
    expect(auto).toContain("<BotResumeCard isAdmin={isAdmin} />");
    const route = read("src/app/api/admin/bot-resume/route.ts");
    expect(route).not.toMatch(/DEFAULT_TENANT_ID/);
    expect(route.match(/if \(!tenantId\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/g)).toHaveLength(2);
  });
});
