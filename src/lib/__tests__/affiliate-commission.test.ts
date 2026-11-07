import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb, type Fake } from "./helpers/affiliate-fakedb";

const h = vi.hoisted(() => ({ fake: null as Fake | null, audit: [] as string[][], emails: [] as unknown[] }));
vi.mock("../supabase", () => ({ db: () => h.fake!.client }));
vi.mock("../tenants", () => ({ ownerAudit: async (a: string, b: string, _t: unknown, d: string) => { h.audit.push([a, b, d]); } }));
vi.mock("../email", () => ({ sendEmail: async (o: unknown) => { h.emails.push(o); return { ok: true }; } }));

import { recordAffiliateCommission, markCommissionsPaid } from "../affiliates";

const DAY = 86400000;
const AFF = "00000000-0000-4000-8000-0000000000a1";
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const comms = () => h.fake!.tables.wa_affiliate_commissions;

function setup(over: { tenant?: Record<string, unknown>; aff?: Record<string, unknown> } = {}) {
  h.fake = makeFakeDb(); h.audit.length = 0; h.emails.length = 0;
  h.fake.tables.wa_affiliates.push({ id: AFF, email: "asha@acme.io", name: "Asha", phone: "9876543210", status: "active", commission_pct: 10, created_at: ago(60), ...over.aff });
  h.fake.tables.tenants.push({ id: "T1", company: "Buyer Co", owner_email: "buyer@other.com", owner_phone: "9000000000", created_at: ago(30), referred_by_affiliate_id: AFF, ...over.tenant });
}
beforeEach(() => setup());

describe("recordAffiliateCommission", () => {
  it("earns 10% of the base amount, payable after the 10-day hold, unflagged", async () => {
    await recordAffiliateCommission("T1", { amountCents: 500000, plan: "growth", providerPaymentId: "pay_1" });
    expect(comms()).toHaveLength(1);
    const c = comms()[0];
    expect(c).toMatchObject({ commission_cents: 50000, flagged: false, provider_payment_id: "pay_1", status: "pending" });
    const days = (Date.parse(c.payable_at as string) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(9.99); expect(days).toBeLessThan(10.01);
  });
  it("dedupes on the provider payment id (verify route and webhook both report it)", async () => {
    await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "pay_1" });
    await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "pay_1" });
    expect(comms()).toHaveLength(1);
    await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "pay_2" });
    expect(comms()).toHaveLength(2);
  });
  it("skips a zero or negative base amount", async () => {
    await recordAffiliateCommission("T1", { amountCents: 0, providerPaymentId: "p0" });
    await recordAffiliateCommission("T1", { amountCents: -5, providerPaymentId: "p-" });
    expect(comms()).toHaveLength(0);
  });
  it("does nothing for an unreferred tenant or a suspended affiliate", async () => {
    setup({ tenant: { referred_by_affiliate_id: null } }); await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "p" }); expect(comms()).toHaveLength(0);
    setup({ aff: { status: "suspended" } }); await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "p" }); expect(comms()).toHaveLength(0);
  });
  it("flags a self-referral (same phone) and audits it, but still records it", async () => {
    setup({ tenant: { owner_phone: "+91 98765 43210" } });
    await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "pay_1" });
    expect(comms()[0]).toMatchObject({ flagged: true }); expect(String(comms()[0].flag_reason)).toContain("same_phone");
    expect(h.audit.some(a => a[1] === "affiliate.commission_flagged")).toBe(true);
  });
  it("flags a tenant created before the affiliate enrolled", async () => {
    setup({ tenant: { created_at: ago(90) } });
    await recordAffiliateCommission("T1", { amountCents: 500000, providerPaymentId: "pay_1" });
    expect(String(comms()[0].flag_reason)).toContain("tenant_predates_affiliate");
  });
  it("flags the 5th conversion within 24h, not the 4th, and ignores renewals of one tenant", async () => {
    for (let i = 1; i <= 4; i++) { h.fake!.tables.tenants.push({ id: `X${i}`, company: "c", owner_email: `o${i}@z${i}.com`, created_at: ago(30), referred_by_affiliate_id: AFF }); await recordAffiliateCommission(`X${i}`, { amountCents: 100000, providerPaymentId: `px${i}` }); }
    expect(comms().some(c => c.flagged)).toBe(false);
    await recordAffiliateCommission("X1", { amountCents: 100000, providerPaymentId: "renewal" });   // same tenant again: not a new conversion
    expect(comms().some(c => c.flagged)).toBe(false);
    await recordAffiliateCommission("T1", { amountCents: 100000, providerPaymentId: "p5" });
    expect(comms().find(c => c.provider_payment_id === "p5")).toMatchObject({ flagged: true, flag_reason: "conversion_velocity" });
  });
  it("legacy Stripe path (no payment id) still records", async () => {
    await recordAffiliateCommission("T1", { amountCents: 500000, subscriptionId: "sub_1", currentPeriodEnd: "2026-12-01" });
    expect(comms()).toHaveLength(1); expect(comms()[0].provider_payment_id).toBeNull();
  });
});

describe("markCommissionsPaid (manual emergency path)", () => {
  const row = (over: Record<string, unknown> = {}) => { const r = { id: crypto.randomUUID(), affiliate_id: AFF, status: "pending", kind: "earning", flagged: false, payout_id: null, payable_at: ago(1), commission_cents: 100, ...over }; comms().push(r); return r; };
  it("marks plain payable rows paid and audits", async () => {
    const r = row(); await markCommissionsPaid(AFF, [r.id as string], "o");
    expect(r.status).toBe("paid"); expect(h.audit[0][1]).toBe("affiliate.payout");
  });
  it("refuses flagged, in-hold, in-payout and non-pending rows without an override", async () => {
    for (const over of [{ flagged: true }, { payable_at: new Date(Date.now() + 3 * DAY).toISOString() }, { status: "processing", payout_id: "p1" }, { status: "paid" }, { kind: "clawback" }]) {
      const r = row(over); await expect(markCommissionsPaid(AFF, [r.id as string], "o")).rejects.toThrow(/Refused/);
      expect(r.status).toBe(over.status ?? "pending");
    }
  });
  it("an override requires a reason, works on flagged/in-hold rows, and is audited as an override", async () => {
    const r = row({ flagged: true });
    await expect(markCommissionsPaid(AFF, [r.id as string], "o", { manualOverride: true })).rejects.toThrow(/reason/);
    await markCommissionsPaid(AFF, [r.id as string], "o", { manualOverride: true, reason: "paid by bank transfer 7 Nov" });
    expect(r.status).toBe("paid"); expect(h.audit.at(-1)![1]).toBe("affiliate.payout_manual_override");
  });
  it("even an override cannot touch a row that is inside a payout", async () => {
    const r = row({ status: "processing", payout_id: "p1" });
    await expect(markCommissionsPaid(AFF, [r.id as string], "o", { manualOverride: true, reason: "x" })).rejects.toThrow(/Refused/);
  });
  it("refuses ids that do not belong to the affiliate", async () => {
    await expect(markCommissionsPaid(AFF, ["nope"], "o")).rejects.toThrow(/not found/);
  });
});
