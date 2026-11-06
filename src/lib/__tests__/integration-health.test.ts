// Phase 3 "integration health": which connections are broken and how to fix
// them, retrying failed deliveries, settling payments that matched no order,
// and admins being emailed once per problem. Synthetic accounts and numbers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({
  m: null as unknown as MemDb,
  settings: {} as Record<string, unknown>,
  sync: {} as Record<string, unknown>,
  paid: [] as Record<string, unknown>[],
  emails: [] as { to: string; subject: string }[],
}));

vi.mock("../supabase", () => ({ db: () => h.m.client }));
vi.mock("../tenantdb", () => ({
  tdb: (t: string) => ({
    from: (tb: string) => {
      const b = h.m.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert;
      b.insert = (p: unknown) => ins(Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  }),
}));
vi.mock("../store", () => ({
  UNANSWERED_AFTER_MS: 120_000,
  getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}|${k}` in h.settings ? h.settings[`${t}|${k}`] : d),
  setTenantSetting: async (t: string, k: string, v: unknown) => { h.settings[`${t}|${k}`] = v; },
}));
vi.mock("../reviews", () => ({ getChannelSync: async (_t: string, id: string) => h.sync[id] ?? null }));
vi.mock("../commerce", () => ({
  markOrderPaid: async (m: Record<string, unknown>) => {
    h.paid.push(m);
    const o = h.m.tables.wa_orders.find(x => x.id === m.orderId);
    if (o) o.status = "paid";
    return { ok: !!o, orderId: m.orderId };
  },
}));
vi.mock("../messaging-settings", () => ({ isAiEnabled: async () => true }));
vi.mock("../email", () => ({ sendEmail: async (e: { to: string; subject: string }) => { h.emails.push(e); return { ok: true }; } }));
vi.mock("../emailtemplate", () => ({ renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("../email-brand", () => ({ applyEmailBrand: (_b: unknown, opts: unknown, siteUrl: string, subject: string) => ({ opts, siteUrl, subject }) }));
vi.mock("../brand-lookup", () => ({ brandForTenant: async () => null }));
vi.mock("../emailprefs", () => ({ unsubscribedRecipients: async () => new Set(), unsubscribeUrl: () => "https://x/unsub" }));

import { healthReport, retryDeadDeliveries, resolveUnmatchedPayment } from "../integration-health";
import { sweepIntegrationAlerts, drainWorkAlertEmails } from "../work-alerts";
import { buildToday } from "../today";
import { WORK_SETTINGS_KEY } from "../work-settings";
import type { WorkViewer } from "../tasks";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-11-06T06:02:00Z");   // 11:32 in India, two minutes past the hour
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const DAY = 1440;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  h.m = memdb({ wa_work_alerts: [["tenant_id", "dedupe_key"]] }); h.settings = {}; h.sync = {}; h.paid = []; h.emails = [];
  process.env.RESEND_API_KEY = "re_test";
  const t = h.m.tables;
  const ch = (id: string, kind: string, x: Record<string, unknown> = {}) => ({ id, tenant_id: T, kind, name: id.toUpperCase(), active: true, token: "tok", created_at: ago(10 * DAY), ...x });
  t.wa_channels = [
    ch("wa1", "whatsapp", { messaging_health: "RESTRICTED", quality_updated_at: ago(30) }),
    ch("wa2", "whatsapp", { messaging_health: "AVAILABLE", quality_rating: "RED", quality_updated_at: ago(60) }),
    ch("wa3", "whatsapp", { messaging_health: "AVAILABLE", quality_rating: "GREEN" }),
    ch("ig1", "instagram"),
    ch("ig2", "instagram", { created_at: ago(70 * DAY) }),
    ch("ig3", "instagram"),
    ch("g1", "google_reviews"),
    ch("g2", "google_reviews"),
    ch("off", "whatsapp", { active: false, messaging_health: "RESTRICTED" }),
    { ...ch("wax", "whatsapp", { messaging_health: "RESTRICTED" }), tenant_id: O },
  ];
  h.settings[`${T}|ig_token_error:ig1`] = { error: "Session has expired", at: ago(120) };
  h.settings[`${T}|ig_token_refreshed_at:ig3`] = ago(5 * DAY);
  h.sync.g1 = { ok: false, kind: "reauth", error: "invalid_grant", at: ago(90), lastSuccessAt: ago(DAY), failures: 1 };
  h.sync.g2 = { ok: false, kind: "transient", error: "timeout", at: ago(10), lastSuccessAt: ago(2 * DAY), failures: 4 };
  t.wa_inbound_connections = [
    { id: "in1", tenant_id: T, kind: "shopify", status: "connected", last_event_at: ago(3 * DAY), last_error: "Bad signature", last_error_at: ago(60) },
    { id: "in2", tenant_id: T, kind: "razorpay", status: "connected", last_event_at: ago(10), last_error: "old", last_error_at: ago(DAY) },   // recovered since
    { id: "in3", tenant_id: T, kind: "calendly", status: "paused", last_event_at: null, last_error: "x", last_error_at: ago(10) },
  ];
  t.wa_integrations = [
    { id: "out1", tenant_id: T, kind: "slack", name: "Sales Slack", active: true, status: "error", status_detail: "channel_not_found", updated_at: ago(300) },
    { id: "out2", tenant_id: T, kind: "webhook", name: "Zapier", active: true, status: "connected", status_detail: null, updated_at: ago(300) },
  ];
  t.wa_crm_sync = [
    { id: "d1", tenant_id: T, status: "dead", attempts: 8, last_error: "LeadSquared 500", created_at: ago(100) },
    { id: "d2", tenant_id: T, status: "dead", attempts: 8, last_error: "x", created_at: ago(200) },
    { id: "dx", tenant_id: O, status: "dead", attempts: 8, last_error: "x", created_at: ago(200) },
  ];
  t.wa_orders = [
    { id: "ord-a", tenant_id: T, phone: "919876500001", status: "pending", total_cents: 150000, created_at: ago(DAY) },
    { id: "ord-b", tenant_id: T, phone: "919876500002", status: "pending", total_cents: 99900, created_at: ago(DAY) },
    { id: "ord-c", tenant_id: T, phone: "919876500003", status: "pending", total_cents: 150000, created_at: ago(10 * DAY) },   // too old to suggest
    { id: "ord-x", tenant_id: O, phone: "919876500009", status: "pending", total_cents: 150000, created_at: ago(DAY) },
  ];
  t.wa_unmatched_payments = [
    { id: "up1", tenant_id: T, provider: "razorpay", payment_key: "pay_1", provider_payment_id: "pay_1", amount_cents: 150000, reason: "no_order", status: "open", order_id: null, created_at: ago(40) },
    { id: "up2", tenant_id: T, provider: "razorpay", payment_key: "pay_2", provider_payment_id: "pay_2", amount_cents: 50000, reason: "short_payment", status: "open", order_id: "ord-b", created_at: ago(50) },
  ];
  t.wa_users = [
    { id: "u1", tenant_id: T, name: "Asha", email: "asha@biz.test", role: "admin", team: null, active: true },
    { id: "u2", tenant_id: T, name: "Ben", email: "ben@biz.test", role: "member", team: null, active: true },
  ];
});
afterEach(() => { vi.useRealTimers(); delete process.env.RESEND_API_KEY; });

describe("the health report", () => {
  it("finds each kind of broken connection, urgent ones first, and nothing from other businesses", async () => {
    const r = await healthReport(T, NOW);
    const keys = r.problems.map(p => p.key);
    expect(new Set(keys)).toEqual(new Set([
      "wa:wa1:restricted", "wa:wa2:quality", "ig:ig1:token", "ig:ig2:expired", "google:g1:reauth", "google:g2:failing",
      "inbound:in1", "outbound:out1", "deliveries:dead", "payment:up1", "payment:up2",
    ]));
    const critical = r.problems.filter(p => p.severity === "critical").map(p => p.key);
    expect(new Set(critical)).toEqual(new Set(["wa:wa1:restricted", "ig:ig1:token", "ig:ig2:expired", "google:g1:reauth"]));
    expect(r.problems.slice(0, 4).every(p => p.severity === "critical")).toBe(true);
    expect(r.problems.find(p => p.key === "deliveries:dead")).toMatchObject({ title: "2 updates couldn't be delivered", detail: "Latest error: LeadSquared 500" });
    expect(r.problems.find(p => p.key === "ig:ig1:token")!.detail).toMatch(/Session has expired/);
    expect(r.deadDeliveries).toBe(2);
    expect(r.checked.filter(c => c.ok).map(c => c.name).sort()).toEqual(["IG3", "Razorpay", "WA3", "Zapier"]);
    // Suggested matches: same amount, unpaid, this business, last 7 days.
    expect(r.unmatchedPayments.find(p => p.id === "up1")!.candidates.map(c => c.id)).toEqual(["ord-a"]);
    expect(r.unmatchedPayments.find(p => p.id === "up2")!.candidates).toEqual([]);
  });

  it("reports nothing for a workspace with healthy connections", async () => {
    const r = await healthReport("30000000-0000-0000-0000-000000000003", NOW);
    expect(r.problems).toEqual([]);
  });
});

describe("fixing", () => {
  it("retries only this business's failed deliveries", async () => {
    expect(await retryDeadDeliveries(T)).toBe(2);
    expect(h.m.tables.wa_crm_sync.filter(d => d.tenant_id === T).every(d => d.status === "pending" && d.attempts === 0)).toBe(true);
    expect(h.m.tables.wa_crm_sync.find(d => d.id === "dx")!.status).toBe("dead");
  });

  it("matches a payment to an order through the normal paid path, once", async () => {
    expect(await resolveUnmatchedPayment(T, "up1", { orderId: "ord-a" }, "asha@biz.test")).toEqual({ ok: true });
    expect(h.paid).toEqual([expect.objectContaining({ orderId: "ord-a", expectTenantId: T, providerPaymentId: "pay_1", amountPaidCents: 150000, provider: "razorpay" })]);
    expect(h.m.tables.wa_unmatched_payments.find(p => p.id === "up1")).toMatchObject({ status: "matched", order_id: "ord-a", resolved_by: "asha@biz.test" });
    expect((await resolveUnmatchedPayment(T, "up1", { dismiss: true }, "asha@biz.test")).status).toBe(409);
  });

  it("refuses the wrong order, another business's order, or a short payment", async () => {
    expect((await resolveUnmatchedPayment(T, "up1", { orderId: "ord-x" }, "a")).status).toBe(404);
    expect((await resolveUnmatchedPayment(T, "up1", { orderId: "ord-b" }, "a")).status).toBeUndefined();   // 1500 ≥ 999: allowed
  });

  it("won't match a payment smaller than the order, and a short payment can only be dismissed", async () => {
    h.m.tables.wa_unmatched_payments[0].amount_cents = 100;
    expect((await resolveUnmatchedPayment(T, "up1", { orderId: "ord-a" }, "a")).status).toBe(400);
    expect((await resolveUnmatchedPayment(T, "up2", { orderId: "ord-a" }, "a")).status).toBe(400);
    expect(await resolveUnmatchedPayment(T, "up2", { dismiss: true }, "a")).toEqual({ ok: true });
    expect(h.paid).toHaveLength(0);
  });
});

describe("admins hear about broken connections", () => {
  it("raises urgent problems, failing deliveries and payments once each, and emails admins only", async () => {
    const n = await sweepIntegrationAlerts(NOW);
    const mine = h.m.tables.wa_work_alerts.filter(a => a.tenant_id === T);
    expect(mine).toHaveLength(7);    // 4 urgent + deliveries + 2 payments; warnings like low quality stay in the app
    expect(n).toBe(9);               // …plus the other business's own restricted number and failed delivery
    expect(mine.map(a => a.dedupe_key).join(" ")).not.toMatch(/wa2|out1|in1/);
    expect(await sweepIntegrationAlerts(NOW)).toBe(0);                  // same problems: no repeats
    expect(await sweepIntegrationAlerts(NOW + 10 * 60_000)).toBe(0);    // only on the first tick after the hour
    await drainWorkAlertEmails(NOW);
    expect(h.emails.map(e => e.to)).toEqual(["asha@biz.test"]);         // admins, even with overdue emails off
    expect(h.emails[0].subject).toBe("7 connections need attention");
  });

  it("doesn't email about a problem that was fixed before the email went out", async () => {
    await sweepIntegrationAlerts(NOW);
    h.m.tables.wa_channels.find(c => c.id === "wa1")!.messaging_health = "AVAILABLE";
    h.m.tables.wa_unmatched_payments.forEach(p => { p.status = "dismissed"; });
    h.m.tables.wa_crm_sync = [];
    delete h.settings[`${T}|ig_token_error:ig1`];
    h.sync = {};
    h.m.tables.wa_channels = h.m.tables.wa_channels.filter(c => c.id !== "ig2");
    await drainWorkAlertEmails(NOW);
    expect(h.emails).toEqual([]);
    expect(h.m.tables.wa_work_alerts.filter(a => a.tenant_id === T).every(a => a.email_error === "Already handled")).toBe(true);
  });

  it("respects a business that turned these emails off", async () => {
    h.settings[`${T}|${WORK_SETTINGS_KEY}`] = { integrationEmails: false };
    h.m.tables.wa_settings = [{ tenant_id: T, key: WORK_SETTINGS_KEY, value: { integrationEmails: false } }];
    await sweepIntegrationAlerts(NOW);
    expect(h.m.tables.wa_work_alerts.filter(a => a.tenant_id === T)).toHaveLength(0);
  });
});

describe("Today", () => {
  const admin: WorkViewer = { user: { email: "asha@biz.test", name: "Asha", role: "admin", tenantId: T }, tenantId: T, allowed: null, canManage: true };
  const member: WorkViewer = { user: { email: "ben@biz.test", name: "Ben", role: "member", tenantId: T }, tenantId: T, allowed: null, canManage: false };
  it("shows admins what's broken, and not other teammates", async () => {
    const a = await buildToday(admin, "u1", NOW);
    expect(a.items.filter(i => i.kind === "connection").length).toBe(11);
    expect(a.items.find(i => i.key === "connection:wa:wa1:restricted")).toMatchObject({ overdue: true, person: "Admins", open: { tab: "setup" } });
    const m = await buildToday(member, "u2", NOW);
    expect(m.items.some(i => i.kind === "connection")).toBe(false);
  });
});
