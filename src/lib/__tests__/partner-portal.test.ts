// White-label, Phase 3: the partner dashboard. What must hold: a partner acts
// only on its own workspaces and staff, never sells below Talko's list price,
// only uses the plans Talko allowed, and its dashboard exists only on its own
// address. The fake database records every filter a write sends.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };
const calls: Call[] = [];
const rows: Record<string, Record<string, unknown> | null> = {};

function builder(table: string) {
  const c: Call = { table, op: "select", filters: [] };
  calls.push(c);
  const b: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
  for (const m of ["select", "order", "limit", "ilike"]) b[m] = chain(() => {});
  b.eq = chain((col, v) => c.filters.push(["eq", col as string, v]));
  b.is = chain((col, v) => c.filters.push(["is", col as string, v]));
  b.update = chain(p => { c.op = "update"; c.payload = p; });
  b.insert = chain(p => { c.op = "insert"; c.payload = p; });
  b.delete = chain(() => { c.op = "delete"; });
  const result = () => ({ data: c.op === "select" ? rows[table] ?? null : [{ id: "x" }], error: null });
  b.maybeSingle = () => Promise.resolve(result());
  b.single = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return b;
}
vi.mock("../supabase", () => ({ db: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("../email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { checkResalePrices, wholesaleShare, monthlyEstimate, checkNewWorkspace, setPartnerWorkspacePaused, setPartnerWorkspacePlan, acceptPartnerInvite } from "../partner-portal";
import type { Partner } from "../partners";

const PLANS = [
  { key: "starter", name: "Starter", priceCents: 1_999_00 },
  { key: "growth", name: "Growth", priceCents: 5_999_00 },
  { key: "scale", name: "Scale", priceCents: 9_999_00 },
];
const PARTNER = {
  id: "p1", slug: "brightdental", name: "Bright Dental", kind: "reseller", tier: "standard", status: "active",
  allowedPlans: ["growth", "scale"], monthlyFeeCents: 9_999_00, wholesalePct: 50, brand: {}, resalePrices: {},
} as unknown as Partner;

beforeEach(() => { calls.length = 0; for (const k of Object.keys(rows)) delete rows[k]; });

describe("reseller prices", () => {
  it("accepts prices at or above list, for allowed plans only", () => {
    expect(checkResalePrices({ growth: 7_999_00, scale: 9_999_00 }, PLANS, ["growth", "scale"])).toEqual({ ok: true, prices: { growth: 7_999_00, scale: 9_999_00 } });
  });
  it("never lets a reseller sell below Talko's list price", () => {
    const r = checkResalePrices({ growth: 5_998_00 }, PLANS, ["growth"]);
    expect(r.ok).toBe(false);
  });
  it("refuses a plan the reseller may not sell, and junk values", () => {
    expect(checkResalePrices({ starter: 2_999_00 }, PLANS, ["growth"]).ok).toBe(false);
    expect(checkResalePrices({ growth: "lots" }, PLANS, ["growth"]).ok).toBe(false);
    expect(checkResalePrices([1, 2], PLANS, ["growth"]).ok).toBe(false);
  });
});

describe("what a partner owes", () => {
  it("applies the volume reward: 45% from 26 live workspaces, 40% above 100", () => {
    expect(wholesaleShare(50, 25)).toBe(50);
    expect(wholesaleShare(50, 26)).toBe(45);
    expect(wholesaleShare(50, 101)).toBe(40);
    expect(wholesaleShare(35, 200)).toBe(35);   // a better negotiated rate is kept
  });
  it("counts live workspaces only: a paused one is free", () => {
    const e = monthlyEstimate(PARTNER, [{ plan: "growth", status: "active" }, { plan: "growth", status: "suspended" }], PLANS);
    expect(e).toMatchObject({ feeCents: 9_999_00, workspacesCents: 2_999_50, totalCents: 12_998_50, live: 1, sharePct: 50 });
  });
  it("Private Label pays plan prices plus its brand fee", () => {
    const e = monthlyEstimate({ kind: "private", monthlyFeeCents: 4_999_00, wholesalePct: null }, [{ plan: "growth", status: "active" }], PLANS);
    expect(e.totalCents).toBe(10_998_00);
  });
});

describe("new customer workspace", () => {
  it("needs a name, a contact, a valid email and an allowed plan", () => {
    const ok = { company: "Smile Clinic", ownerName: "Asha Rao", ownerEmail: "Asha@Smile.in ", plan: "growth" };
    expect(checkNewWorkspace(ok, ["growth"])).toMatchObject({ ok: true, v: { ownerEmail: "asha@smile.in" } });
    expect(checkNewWorkspace({ ...ok, plan: "starter" }, ["growth"]).ok).toBe(false);
    expect(checkNewWorkspace({ ...ok, ownerEmail: "nope" }, ["growth"]).ok).toBe(false);
    expect(checkNewWorkspace({ ...ok, company: "" }, ["growth"]).ok).toBe(false);
  });
});

describe("only its own workspaces", () => {
  it("pauses through a partner_id-filtered write", async () => {
    rows.tenants = { id: "t1", name: "Smile", company: "Smile", plan: "growth", status: "active", created_at: "2026-10-30" };
    expect((await setPartnerWorkspacePaused(PARTNER, "t1", true, "a@b.co")).ok).toBe(true);
    const up = calls.find(c => c.table === "tenants" && c.op === "update")!;
    expect(up.payload).toEqual({ status: "suspended" });
    expect(up.filters).toEqual(expect.arrayContaining([["eq", "id", "t1"], ["eq", "partner_id", "p1"]]));
  });
  it("refuses another partner's workspace without writing", async () => {
    rows.tenants = null;   // the partner_id-filtered read finds nothing
    expect((await setPartnerWorkspacePaused(PARTNER, "t9", true, "a@b.co")).error).toMatch(/isn't one of yours/);
    expect((await setPartnerWorkspacePlan(PARTNER, "t9", "growth", "a@b.co")).error).toMatch(/isn't one of yours/);
    expect(calls.some(c => c.op === "update")).toBe(false);
  });
  it("refuses a plan Talko didn't allow, before reading anything", async () => {
    expect((await setPartnerWorkspacePlan(PARTNER, "t1", "starter", "a@b.co")).error).toMatch(/your plans/);
    expect(calls.length).toBe(0);
  });
});

describe("invitations", () => {
  it("won't set a password on another partner's address", async () => {
    rows.wa_partner_users = { id: "u1", partner_id: "p1", email: "x@y.co", active: true, setup_expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    rows.wa_partners = { id: "p1", slug: "brightdental", status: "active" };
    const r = await acceptPartnerInvite("tok", "a-long-password", "someoneelse");
    expect(r.error).toMatch(/different address/);
    expect(calls.some(c => c.op === "update")).toBe(false);
  });
  it("refuses an expired invitation and a short password", async () => {
    expect((await acceptPartnerInvite("tok", "short", "brightdental")).error).toMatch(/10 characters/);
    rows.wa_partner_users = { id: "u1", partner_id: "p1", email: "x@y.co", active: true, setup_expires_at: new Date(Date.now() - 1000).toISOString() };
    expect((await acceptPartnerInvite("tok", "a-long-password", "brightdental")).error).toMatch(/expired/);
  });
});

describe("the dashboard's address", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  async function hit(host: string, path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
    vi.stubEnv("WHITE_LABEL_ENABLED", "1");
    vi.resetModules();
    const { middleware } = await import("../../middleware");
    return middleware(new NextRequest(`https://${host}${path}`, { method: init.method ?? "GET", headers: { host, ...(init.headers ?? {}) } }));
  }

  it("asks a signed-out visitor to sign in", async () => {
    const r = await hit("brightdental.thetalko.in", "/partner");
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/partner/login");
  });
  it("keeps the sign-in and invite pages open", async () => {
    for (const p of ["/partner/login", "/partner/setup"]) expect((await hit("brightdental.thetalko.in", p)).status).toBe(200);
  });
  it("doesn't exist on Talko's own address", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_HOST", "app.thetalko.in");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_HOST", "thetalko.in");
    expect((await hit("app.thetalko.in", "/partner")).status).toBe(404);
  });
  it("answers its APIs only to a partner session, and blocks cross-site posts", async () => {
    expect((await hit("brightdental.thetalko.in", "/api/partner/me")).status).toBe(401);
    expect((await hit("brightdental.thetalko.in", "/api/partner/login", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
});
