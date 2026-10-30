// White-label, Phase 4: money. What must hold: periods and part-months are
// computed in India time; a partner's own webhook is verified with that
// partner's secret and only touches that partner's invoices; a partner can't
// lift a pause its balance (or Talko) put on; nothing runs while white-label
// is off.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };
const calls: Call[] = [];
const rows: Record<string, unknown> = {};
const rpcCalls: Record<string, unknown>[] = [];

function builder(table: string) {
  const c: Call = { table, op: "select", filters: [] };
  calls.push(c);
  const b: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
  for (const m of ["select", "order", "limit", "lt", "neq"]) b[m] = chain(() => {});
  b.eq = chain((col, v) => c.filters.push(["eq", col as string, v]));
  b.in = chain((col, v) => c.filters.push(["in", col as string, v]));
  b.is = chain((col, v) => c.filters.push(["is", col as string, v]));
  b.update = chain(p => { c.op = "update"; c.payload = p; });
  const result = () => ({ data: (rows[`${table}:${c.op}`] ?? rows[table] ?? null), error: null });
  b.maybeSingle = () => Promise.resolve(result());
  b.single = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return b;
}
vi.mock("../supabase", () => ({
  db: () => ({
    from: (t: string) => builder(t),
    rpc: async (_fn: string, args: Record<string, unknown>) => { rpcCalls.push(args); return { data: [{ ok: true, balance_cents: 0, duplicate: false, short: false }], error: null }; },
  }),
}));
vi.mock("../crypto", () => ({ readSecret: (v: string | null) => v, encryptSecret: (v: string) => v }));
vi.mock("../email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { billingPeriod, prorataCents, workspaceMonthlyCents, customerPeriod, checkCustomerBilling, handlePartnerRazorpayWebhook, drainPartnerBilling, drainCustomerBilling } from "../partner-billing";
import { setPartnerWorkspacePaused } from "../partner-portal";
import type { Partner } from "../partners";

const at = (iso: string) => new Date(iso);
beforeEach(() => { calls.length = 0; rpcCalls.length = 0; for (const k of Object.keys(rows)) delete rows[k]; });
afterEach(() => vi.unstubAllEnvs());

describe("billing periods (India time)", () => {
  it("runs from the billing day to the day before it next month", () => {
    const p = billingPeriod(at("2026-10-20T06:00:00Z"), 5);
    expect(p.period).toBe("2026-10");
    expect(p.start.toISOString()).toBe("2026-10-04T18:30:00.000Z");   // 5 Oct 00:00 IST
    expect(p.end.toISOString()).toBe("2026-11-04T18:30:00.000Z");
  });
  it("belongs to last month before the billing day, across the year end", () => {
    expect(billingPeriod(at("2027-01-03T06:00:00Z"), 5).period).toBe("2026-12");
    expect(billingPeriod(at("2026-12-20T06:00:00Z"), 5).period).toBe("2026-12");
  });
  it("switches at midnight India time, not UTC", () => {
    expect(billingPeriod(at("2026-11-04T18:29:00Z"), 5).period).toBe("2026-10");   // 4 Nov 23:59 IST
    expect(billingPeriod(at("2026-11-04T18:31:00Z"), 5).period).toBe("2026-11");   // 5 Nov 00:01 IST
  });
  it("customer invoices use the calendar month in India", () => {
    expect(customerPeriod(at("2026-10-31T19:00:00Z"))).toBe("2026-11");
  });
});

describe("part-month charges", () => {
  it("is the full price at the start of a period and nothing at its end", () => {
    const p = billingPeriod(at("2026-10-20T06:00:00Z"), 1);
    expect(prorataCents(30_000, p.start, 1)).toBe(30_000);
    expect(prorataCents(30_000, new Date(p.end.getTime() - 1), 1)).toBe(0);
  });
  it("is roughly half mid-period", () => {
    const c = prorataCents(31_000, at("2026-10-16T18:30:00Z"), 1);   // 17 Oct 00:00 IST of a 31-day period
    expect(c).toBeGreaterThan(14_000);
    expect(c).toBeLessThan(16_000);
  });
  it("prices a workspace at the reseller's share, or the full plan for Private Label", () => {
    const plans = [{ key: "growth", priceCents: 5_999_00 }];
    expect(workspaceMonthlyCents({ kind: "reseller", wholesalePct: 50 }, "growth", plans, 3)).toBe(2_999_50);
    expect(workspaceMonthlyCents({ kind: "reseller", wholesalePct: 50 }, "growth", plans, 30)).toBe(2_699_55);   // 45% at volume
    expect(workspaceMonthlyCents({ kind: "private", wholesalePct: null }, "growth", plans, 3)).toBe(5_999_00);
  });
});

describe("customer billing settings", () => {
  it("keeps grace days sensible", () => {
    expect(checkCustomerBilling({ graceDays: 0 }).ok).toBe(false);
    expect(checkCustomerBilling({ graceDays: 90 }).ok).toBe(false);
    expect(checkCustomerBilling({ autoLinks: true, graceDays: 5, autoPause: true })).toEqual({ ok: true, v: { autoLinks: true, graceDays: 5, autoPause: true } });
  });
});

describe("a partner's own Razorpay webhook", () => {
  const SECRET = "whsec_partner_one";
  const body = (partnerId: string) => JSON.stringify({
    event: "payment_link.paid",
    payload: { payment_link: { entity: { id: "plink_1", notes: { kind: "partner_customer", partner_id: partnerId, tenant_id: "t1" } } } },
  });
  const sign = (raw: string, s = SECRET) => crypto.createHmac("sha256", s).update(raw).digest("hex");

  it("rejects a bad signature without writing", async () => {
    rows.wa_partners = { razorpay: { keyId: "rzp_test_x", secretEnc: "sk", webhookSecretEnc: SECRET } };
    const raw = body("p1");
    expect((await handlePartnerRazorpayWebhook("p1", raw, sign(raw, "someone-else"))).status).toBe(401);
    expect(calls.some(c => c.op === "update")).toBe(false);
  });

  it("marks that partner's invoice paid and lifts only an unpaid-customer pause", async () => {
    rows.wa_partners = { razorpay: { keyId: "rzp_test_x", secretEnc: "sk", webhookSecretEnc: SECRET } };
    rows["wa_partner_invoices:update"] = [{ tenant_id: "t1" }];
    rows["tenants:update"] = [{ id: "t1" }];
    const raw = body("p1");
    expect((await handlePartnerRazorpayWebhook("p1", raw, sign(raw))).status).toBe(200);
    const inv = calls.find(c => c.table === "wa_partner_invoices" && c.op === "update")!;
    expect(inv.filters).toEqual(expect.arrayContaining([["eq", "partner_id", "p1"], ["eq", "link_id", "plink_1"]]));
    const t = calls.find(c => c.table === "tenants" && c.op === "update")!;
    expect(t.filters).toEqual(expect.arrayContaining([["eq", "partner_id", "p1"], ["eq", "partner_pause", "unpaid"]]));
  });

  it("ignores a link that names a different partner", async () => {
    rows.wa_partners = { razorpay: { keyId: "rzp_test_x", secretEnc: "sk", webhookSecretEnc: SECRET } };
    const raw = body("p2");
    expect((await handlePartnerRazorpayWebhook("p1", raw, sign(raw))).status).toBe(200);
    expect(calls.some(c => c.op === "update")).toBe(false);
  });
});

describe("pauses keep their cause", () => {
  const P = { id: "p1" } as Partner;
  it("a partner can't resume a workspace its balance paused", async () => {
    rows.tenants = { id: "t1", name: "X", company: "X", plan: "growth", status: "suspended", partner_pause: "billing", created_at: "2026-10-30" };
    expect((await setPartnerWorkspacePaused(P, "t1", false, "a@b.co")).error).toMatch(/balance is short/);
    expect(calls.some(c => c.op === "update")).toBe(false);
  });
  it("nor one Talko paused", async () => {
    rows.tenants = { id: "t1", name: "X", company: "X", plan: "growth", status: "suspended", partner_pause: "talko", created_at: "2026-10-30" };
    expect((await setPartnerWorkspacePaused(P, "t1", false, "a@b.co")).error).toMatch(/Talko/);
  });
  it("records its own pause as the partner's", async () => {
    rows.tenants = { id: "t1", name: "X", company: "X", plan: "growth", status: "active", partner_pause: null, created_at: "2026-10-30" };
    expect((await setPartnerWorkspacePaused(P, "t1", true, "a@b.co")).ok).toBe(true);
    const up = calls.find(c => c.table === "tenants" && c.op === "update")!;
    expect(up.payload).toEqual({ status: "suspended", partner_pause: "partner" });
  });
});

describe("while white-label is off", () => {
  it("billing runs touch nothing", async () => {
    expect(await drainPartnerBilling()).toEqual({ partners: 0, charged: 0, grace: 0, suspended: 0 });
    expect(await drainCustomerBilling()).toEqual({ links: 0, paused: 0 });
    expect(calls.length + rpcCalls.length).toBe(0);
  });
});
