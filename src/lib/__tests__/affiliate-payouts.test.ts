import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeFakeDb, type Fake } from "./helpers/affiliate-fakedb";

const h = vi.hoisted(() => ({ fake: null as Fake | null, audit: [] as string[][], emails: [] as { to: string; subject: string; html: string }[], rzp: { createPayout: null as null | ((p: unknown) => Promise<unknown>) } }));
vi.mock("../supabase", () => ({ db: () => h.fake!.client }));
vi.mock("../tenants", () => ({ ownerAudit: async (actor: string, action: string, _t: unknown, detail: string) => { h.audit.push([actor, action, detail]); } }));
vi.mock("../email", () => ({ sendEmail: async (o: { to: string; subject: string; html: string }) => { h.emails.push(o); return { ok: true }; } }));
vi.mock("../crypto", () => ({
  encryptSecret: (s: string) => `enc(${s.length})`,
  // Tests store manual-mode destinations as "PLAIN:<json>" so the decrypt path can be exercised.
  decryptSecret: (b: string) => { if (!b.startsWith("PLAIN:")) throw new Error("bad blob"); return b.slice(6); },
}));
vi.mock("../affiliates", () => ({ getAffiliate: async (id: string) => { const r = h.fake!.tables.wa_affiliates.find(a => a.id === id); return r ? { id: r.id, email: r.email, name: r.name, phone: r.phone ?? null, status: r.status } : null; } }));
vi.mock("../razorpayx", async orig => {
  const real = await orig<typeof import("../razorpayx")>();
  return {
    ...real,
    createPayout: vi.fn(async (p: unknown) => h.rzp.createPayout!(p)),
    createContact: vi.fn(async () => ({ id: "cont_1" })),
    createFundAccount: vi.fn(async () => ({ id: "fa_new", account_type: "vpa" })),
    startFundAccountValidation: vi.fn(async () => ({ id: "fav_1", status: "created" })),
  };
});

import * as P from "../affiliate-payouts";
import * as X from "../razorpayx";

const DAY = 86400000;
const AFF = "00000000-0000-4000-8000-0000000000a1";
const TEN = "00000000-0000-4000-8000-0000000000b1";
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

function addAffiliate(over: Record<string, unknown> = {}) {
  h.fake!.tables.wa_affiliates.push({ id: AFF, email: "asha@acme.io", name: "Asha Rao", phone: null, status: "active", risk_hold: false,
    payout_kind: "upi", payout_last4: "1234", payout_name: "Asha Rao", rzpx_fund_account_id: "fa_1", rzpx_contact_id: "cont_1",
    payout_verified_at: ago(9), payout_changed_at: ago(10), ...over });
}
function addCommission(over: Record<string, unknown> = {}) {
  const r = { id: crypto.randomUUID(), affiliate_id: AFF, tenant_id: TEN, plan: "growth", amount_cents: 500000, commission_pct: 10, commission_cents: 50000,
    status: "pending", kind: "earning", flagged: false, payout_id: null, payable_at: ago(1), created_at: ago(11), provider_payment_id: `pay_${Math.random()}`, ...over };
  h.fake!.tables.wa_affiliate_commissions.push(r);
  return r;
}
const payouts = () => h.fake!.tables.wa_affiliate_payouts;
const comms = () => h.fake!.tables.wa_affiliate_commissions;

beforeEach(() => {
  h.fake = makeFakeDb(); h.audit.length = 0; h.emails.length = 0;
  h.rzp.createPayout = async () => ({ id: "pout_1", status: "queued" });
  process.env.RAZORPAY_KEY_ID = "rzp_test_dummy"; process.env.RAZORPAY_KEY_SECRET = "dummy"; process.env.RAZORPAYX_ACCOUNT_NUMBER = "2323230000000000";
  for (const f of [X.createPayout, X.createContact, X.createFundAccount, X.startFundAccountValidation]) vi.mocked(f).mockClear();
});
afterEach(() => { for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAYX_ACCOUNT_NUMBER", "AFFILIATE_MAX_PAYOUT_CENTS", "AFFILIATE_30D_CAP_CENTS", "AFFILIATE_DAILY_CAP_CENTS", "AFFILIATE_AUTO_APPROVE_MAX_CENTS", "AFFILIATE_MIN_PAYOUT_CENTS", "AFFILIATE_PAYOUT_MODE"]) delete process.env[k]; });

describe("limits and validation", () => {
  it("has the owner-decided defaults", () => {
    expect(P.payoutLimits()).toEqual({ minCents: 50_000, maxCents: 2_500_000, affiliate30dCents: 5_000_000, globalDailyCents: 10_000_000, autoApproveMaxCents: 0 });
  });
  it("accepts env overrides and ignores junk", () => {
    process.env.AFFILIATE_MAX_PAYOUT_CENTS = "100000"; process.env.AFFILIATE_AUTO_APPROVE_MAX_CENTS = "x";
    expect(P.payoutLimits().maxCents).toBe(100000); expect(P.payoutLimits().autoApproveMaxCents).toBe(0);
  });
  it("idempotency key is the payout id, stable across calls", () => {
    expect(P.idempotencyKeyFor("abc")).toBe("abc"); expect(P.idempotencyKeyFor("abc")).toBe(P.idempotencyKeyFor("abc"));
  });
  it("validates VPA, IFSC and account numbers strictly", () => {
    expect(P.validateVpa("Asha.Rao@OkHdfc")).toBe("asha.rao@okhdfc");
    for (const bad of ["asha", "a@b", "asha@@bank", "as ha@bank", "@bank", 12, null, "a@bank;drop"]) expect(P.validateVpa(bad)).toBeNull();
    expect(P.validateIfscCode("sbin0001234")).toBe("SBIN0001234");
    for (const bad of ["SBIN1001234", "SBI0001234", "SBIN000123", 5, ""]) expect(P.validateIfscCode(bad)).toBeNull();
    expect(P.validateAccountNumber("1234 5678 9012")).toBe("123456789012");
    for (const bad of ["12345678", "1234567890123456789", "abc123456789", "111111111", 12345678901]) expect(P.validateAccountNumber(bad)).toBeNull();
  });
});

describe("payoutBlockers", () => {
  const base = { status: "active", riskHold: false, payoutKind: "upi", fundAccountId: "fa", verifiedAt: ago(9), changedAt: ago(10) };
  it("is empty for an eligible affiliate", () => expect(P.payoutBlockers(base)).toEqual([]));
  it("blocks a destination changed within 7 days, even if verified", () => {
    expect(P.payoutBlockers({ ...base, changedAt: ago(3), verifiedAt: ago(2) })).toEqual(["payout_account_changed_recently"]);
    expect(P.payoutBlockers({ ...base, changedAt: ago(7.5), verifiedAt: ago(7) })).toEqual([]);
  });
  it("blocks unverified, stale verification, no account, hold, suspended", () => {
    expect(P.payoutBlockers({ ...base, verifiedAt: null })).toContain("payout_account_unverified");
    expect(P.payoutBlockers({ ...base, verifiedAt: ago(20) })).toContain("payout_account_unverified");
    expect(P.payoutBlockers({ ...base, payoutKind: null })).toContain("no_payout_account");
    expect(P.payoutBlockers({ ...base, riskHold: true })).toContain("risk_hold");
    expect(P.payoutBlockers({ ...base, status: "suspended" })).toContain("affiliate_not_active");
  });
});

describe("createPayoutRequest (claim)", () => {
  it("bundles payable commissions into one awaiting-approval payout and marks them processing", async () => {
    addAffiliate(); addCommission(); addCommission();
    const id = await P.createPayoutRequest(AFF, "owner@x");
    expect(id).toBeTruthy();
    expect(payouts()[0]).toMatchObject({ amount_cents: 100000, status: "awaiting_approval" });
    expect(comms().every(c => c.status === "processing" && c.payout_id === id)).toBe(true);
  });
  it("cannot double-claim: a second request finds nothing", async () => {
    addAffiliate(); addCommission(); addCommission();
    expect(await P.createPayoutRequest(AFF)).toBeTruthy();
    expect(await P.createPayoutRequest(AFF)).toBeNull();
    expect(payouts()).toHaveLength(1);
  });
  it("excludes flagged commissions and commissions still inside the hold", async () => {
    addAffiliate(); addCommission({ commission_cents: 30000 }); addCommission({ flagged: true, commission_cents: 60000 }); addCommission({ payable_at: new Date(Date.now() + 3 * DAY).toISOString(), commission_cents: 60000 });
    expect(await P.createPayoutRequest(AFF)).toBeNull();   // only 30000 payable: below the 50000 minimum
    addCommission({ commission_cents: 25000 });
    const id = await P.createPayoutRequest(AFF);
    expect(id).toBeTruthy();
    expect(payouts()[0].amount_cents).toBe(55000);
    expect(comms().filter(c => c.flagged).every(c => c.status === "pending" && !c.payout_id)).toBe(true);
  });
  it("enforces the minimum", async () => { addAffiliate(); addCommission({ commission_cents: 49999 }); expect(await P.createPayoutRequest(AFF)).toBeNull(); });
  it("enforces the per-payout cap by taking oldest rows first up to the cap", async () => {
    process.env.AFFILIATE_MAX_PAYOUT_CENTS = "120000";
    addAffiliate(); addCommission({ commission_cents: 50000, payable_at: ago(5) }); addCommission({ commission_cents: 50000, payable_at: ago(4) }); addCommission({ commission_cents: 50000, payable_at: ago(3) });
    await P.createPayoutRequest(AFF);
    expect(payouts()[0].amount_cents).toBe(100000);
    expect(comms().filter(c => c.status === "pending")).toHaveLength(1);
  });
  it("nets clawbacks against the payout", async () => {
    addAffiliate(); addCommission({ commission_cents: 80000 });
    addCommission({ kind: "clawback", commission_cents: -20000, provider_payment_id: null, payable_at: null });
    await P.createPayoutRequest(AFF);
    expect(payouts()[0].amount_cents).toBe(60000);
  });
  it("blocks a changed bank account for 7 days, then allows it", async () => {
    addAffiliate({ payout_changed_at: ago(3), payout_verified_at: ago(2) }); addCommission({ commission_cents: 80000 });
    expect(await P.createPayoutRequest(AFF)).toBeNull();
    h.fake!.tables.wa_affiliates[0].payout_changed_at = ago(8); h.fake!.tables.wa_affiliates[0].payout_verified_at = ago(7.9);
    expect(await P.createPayoutRequest(AFF)).toBeTruthy();
  });
  it("refuses risk-held and unverified affiliates", async () => {
    addAffiliate({ risk_hold: true }); addCommission({ commission_cents: 80000 });
    expect(await P.createPayoutRequest(AFF)).toBeNull();
    h.fake!.tables.wa_affiliates[0].risk_hold = false; h.fake!.tables.wa_affiliates[0].payout_verified_at = null;
    expect(await P.createPayoutRequest(AFF)).toBeNull();
  });
  it("never auto-approves by default, even for a small payout", async () => {
    addAffiliate(); addCommission({ commission_cents: 80000 });
    await P.createPayoutRequest(AFF);
    expect(payouts()[0].status).toBe("awaiting_approval"); expect(X.createPayout).not.toHaveBeenCalled();
  });
});

async function pending(cents = 80000) { addAffiliate(); addCommission({ commission_cents: cents }); return (await P.createPayoutRequest(AFF))!; }

describe("approvePayout", () => {
  it("sends the payout once with the payout id as idempotency key and moves to processing", async () => {
    const id = await pending();
    const r = await P.approvePayout(id, "owner@x");
    expect(r).toEqual({ status: "processing", rzpPayoutId: "pout_1", manual: false });
    expect(X.createPayout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(X.createPayout).mock.calls[0][0]).toMatchObject({ idempotencyKey: id, referenceId: id, amountCents: 80000, kind: "upi", fundAccountId: "fa_1" });
    expect(payouts()[0]).toMatchObject({ status: "processing", rzp_payout_id: "pout_1", approved_by: "owner@x" });
    expect(h.audit.some(a => a[1] === "affiliate.payout_approved")).toBe(true);
  });
  it("refuses a second approval of the same payout", async () => {
    const id = await pending(); await P.approvePayout(id, "o");
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/already/);
    expect(X.createPayout).toHaveBeenCalledTimes(1);
  });
  it("fails closed when RazorpayX mode is forced but not configured, before changing anything", async () => {
    const id = await pending(); delete process.env.RAZORPAYX_ACCOUNT_NUMBER; process.env.AFFILIATE_PAYOUT_MODE = "razorpayx";
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/not configured/);
    expect(payouts()[0].status).toBe("awaiting_approval");
  });
  it("re-checks affiliate state at approve time: risk hold added after the request", async () => {
    const id = await pending(); h.fake!.tables.wa_affiliates[0].risk_hold = true;
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/risk_hold/);
    expect(X.createPayout).not.toHaveBeenCalled(); expect(payouts()[0].status).toBe("awaiting_approval");
  });
  it("refuses when the payout account changed after the request", async () => {
    const id = await pending(); h.fake!.tables.wa_affiliates[0].rzpx_fund_account_id = "fa_other"; h.fake!.tables.wa_affiliates[0].payout_changed_at = ago(1);
    await expect(P.approvePayout(id, "o")).rejects.toThrow();
    expect(X.createPayout).not.toHaveBeenCalled();
  });
  it("enforces the per-affiliate rolling 30-day cap", async () => {
    process.env.AFFILIATE_30D_CAP_CENTS = "100000";
    addAffiliate(); h.fake!.tables.wa_affiliate_payouts.push({ id: "old", affiliate_id: AFF, amount_cents: 60000, status: "paid", approved_at: ago(5) });
    addCommission({ commission_cents: 60000 }); const id = (await P.createPayoutRequest(AFF))!;
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/30-day payout cap/);
    expect(X.createPayout).not.toHaveBeenCalled(); expect(payouts().find(p => p.id === id)!.status).toBe("awaiting_approval");
  });
  it("does not count payouts older than 30 days toward the affiliate cap", async () => {
    process.env.AFFILIATE_30D_CAP_CENTS = "100000";
    addAffiliate(); h.fake!.tables.wa_affiliate_payouts.push({ id: "old", affiliate_id: AFF, amount_cents: 60000, status: "paid", approved_at: ago(40) });
    addCommission({ commission_cents: 60000 }); const id = (await P.createPayoutRequest(AFF))!;
    await expect(P.approvePayout(id, "o")).resolves.toBeTruthy();
  });
  it("enforces the global daily cap across affiliates", async () => {
    process.env.AFFILIATE_DAILY_CAP_CENTS = "100000";
    h.fake!.tables.wa_affiliate_payouts.push({ id: "other", affiliate_id: "someone-else", amount_cents: 90000, status: "processing", approved_at: ago(0.1) });
    const id = await pending(80000);
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/daily/);
    expect(X.createPayout).not.toHaveBeenCalled();
  });
  it("cancels and releases when a commission was flagged after the request", async () => {
    const id = await pending(); comms()[0].flagged = true;
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/flagged/);
    expect(payouts()[0].status).toBe("cancelled"); expect(comms()[0]).toMatchObject({ status: "pending", payout_id: null });
  });
  it("cancels when a refund clawback arrived for a claimed commission", async () => {
    const id = await pending(); const c = comms()[0];
    addCommission({ kind: "clawback", commission_cents: -10000, ref_commission_id: c.id, provider_payment_id: null, payable_at: null });
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/refund/);
    expect(payouts()[0].status).toBe("cancelled");
  });
  it("a definite RazorpayX refusal releases the rows", async () => {
    const id = await pending(); h.rzp.createPayout = async () => { throw new X.RazorpayXError("Insufficient balance", 400); };
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/Insufficient/);
    expect(payouts()[0].status).toBe("failed"); expect(comms()[0]).toMatchObject({ status: "pending", payout_id: null });
  });
  it("an unknown-outcome error keeps it approved and a retry re-sends with the SAME key", async () => {
    const id = await pending(); h.rzp.createPayout = async () => { throw new X.RazorpayXError("gateway timeout", 504); };
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/idempotency/);
    expect(payouts()[0].status).toBe("approved"); expect(comms()[0].status).toBe("processing");
    h.rzp.createPayout = async () => ({ id: "pout_9", status: "queued" });
    await P.approvePayout(id, "o");
    const keys = vi.mocked(X.createPayout).mock.calls.map(c => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys)).toEqual(new Set([id])); expect(payouts()[0].status).toBe("processing");
  });
  it("an immediately processed payout settles", async () => {
    const id = await pending(); h.rzp.createPayout = async () => ({ id: "pout_2", status: "processed", utr: "UTR9" });
    await P.approvePayout(id, "o");
    expect(payouts()[0]).toMatchObject({ status: "paid", utr: "UTR9" }); expect(comms()[0].status).toBe("paid");
  });
});

describe("rejectPayout", () => {
  it("releases the commissions", async () => {
    const id = await pending(); await P.rejectPayout(id, "o", "looks off");
    expect(payouts()[0].status).toBe("cancelled"); expect(comms()[0]).toMatchObject({ status: "pending", payout_id: null });
  });
  it("cannot reject a payout that was already sent", async () => {
    const id = await pending(); await P.approvePayout(id, "o");
    await expect(P.rejectPayout(id, "o")).rejects.toThrow(/awaiting approval/);
    expect(comms()[0].status).toBe("processing");
  });
});

describe("payout webhook", () => {
  const ev = (event: string, over: Record<string, unknown> = {}) => ({ event, payload: { payout: { entity: { id: "pout_1", status: event.split(".")[1], utr: "UTR1", reference_id: payouts()[0]?.id as string | undefined, ...over } } } });
  async function sent() { const id = await pending(); await P.approvePayout(id, "o"); return id; }

  it("payout.processed pays once; a replay does not double pay or double email", async () => {
    await sent();
    const a = await P.handlePayoutWebhook(ev("payout.processed"));
    const b = await P.handlePayoutWebhook(ev("payout.processed"));
    expect(a.outcome).toBe("paid"); expect(b.outcome).toBe("no_change");
    expect(payouts()[0]).toMatchObject({ status: "paid", utr: "UTR1" });
    expect(comms()[0].status).toBe("paid");
    expect(h.emails.filter(e => /payout was sent/.test(e.subject))).toHaveLength(1);
    expect(h.audit.filter(a => a[1] === "affiliate.payout_paid")).toHaveLength(1);
  });
  it("payout.failed releases the rows so they can be claimed again", async () => {
    await sent();
    expect((await P.handlePayoutWebhook(ev("payout.failed", { failure_reason: "bank down" }))).outcome).toBe("released");
    expect(payouts()[0]).toMatchObject({ status: "failed", failure_reason: "bank down" });
    expect(comms()[0]).toMatchObject({ status: "pending", payout_id: null });
    expect(await P.createPayoutRequest(AFF)).toBeTruthy();
  });
  it("payout.rejected also releases; a replay is ignored", async () => {
    await sent();
    expect((await P.handlePayoutWebhook(ev("payout.rejected"))).outcome).toBe("released");
    expect((await P.handlePayoutWebhook(ev("payout.rejected"))).outcome).toBe("ignored");
  });
  it("failed after paid does not un-pay", async () => {
    await sent(); await P.handlePayoutWebhook(ev("payout.processed"));
    expect((await P.handlePayoutWebhook(ev("payout.failed"))).outcome).toBe("ignored");
    expect(payouts()[0].status).toBe("paid"); expect(comms()[0].status).toBe("paid");
  });
  it("payout.reversed after paid releases the rows and puts the affiliate on risk hold", async () => {
    await sent(); await P.handlePayoutWebhook(ev("payout.processed"));
    expect((await P.handlePayoutWebhook(ev("payout.reversed"))).outcome).toBe("reversed");
    expect(payouts()[0].status).toBe("reversed"); expect(comms()[0]).toMatchObject({ status: "pending", payout_id: null });
    expect(h.fake!.tables.wa_affiliates[0].risk_hold).toBe(true);
    expect(await P.createPayoutRequest(AFF)).toBeNull();   // held
  });
  it("matches by reference_id when the event outruns our write of the payout id", async () => {
    const id = await pending(); payouts()[0].status = "approved";   // approved, send in flight, rzp id not stored yet
    const r = await P.handlePayoutWebhook({ event: "payout.processed", payload: { payout: { entity: { id: "pout_early", status: "processed", reference_id: id, utr: "U" } } } });
    expect(r.outcome).toBe("paid"); expect(payouts()[0].rzp_payout_id).toBe("pout_early");
  });
  it("ignores progress events and unknown payouts", async () => {
    await sent();
    expect((await P.handlePayoutWebhook(ev("payout.queued"))).outcome).toBe("ignored");
    expect((await P.handlePayoutWebhook({ event: "payout.processed", payload: { payout: { entity: { id: "nope", status: "processed" } } } })).handled).toBe(false);
    expect(payouts()[0].status).toBe("processing");
  });
});

describe("refunds and disputes (applyPaymentReversal)", () => {
  it("a refund before the commission is claimed voids it, and it is never paid", async () => {
    addAffiliate(); const c = addCommission({ provider_payment_id: "pay_A" }); addCommission({ commission_cents: 60000 });
    expect(await P.applyPaymentReversal({ paymentId: "pay_A", event: "refund", refundAmount: 100, paymentAmount: 100 })).toBe("voided");
    expect(c.status).toBe("void");
    await P.createPayoutRequest(AFF);
    expect(payouts()[0].amount_cents).toBe(60000);
  });
  it("replayed refund is harmless", async () => {
    addAffiliate(); addCommission({ provider_payment_id: "pay_A" });
    await P.applyPaymentReversal({ paymentId: "pay_A", event: "refund", refundAmount: 100, paymentAmount: 100 });
    expect(await P.applyPaymentReversal({ paymentId: "pay_A", event: "refund", refundAmount: 100, paymentAmount: 100 })).toBe("already_void");
  });
  it("a refund after the commission was claimed writes ONE clawback, which nets off the next payout", async () => {
    addAffiliate(); const c = addCommission({ provider_payment_id: "pay_B", commission_cents: 80000 });
    const id = (await P.createPayoutRequest(AFF))!; await P.approvePayout(id, "o"); await P.handlePayoutWebhook({ event: "payout.processed", payload: { payout: { entity: { id: "pout_1", status: "processed" } } } });
    expect(c.status).toBe("paid");
    expect(await P.applyPaymentReversal({ paymentId: "pay_B", event: "refund", refundAmount: 100, paymentAmount: 100 })).toBe("clawback");
    expect(await P.applyPaymentReversal({ paymentId: "pay_B", event: "refund", refundAmount: 100, paymentAmount: 100 })).toBe("clawback");
    const claws = comms().filter(r => r.kind === "clawback");
    expect(claws).toHaveLength(1); expect(claws[0]).toMatchObject({ commission_cents: -80000, ref_commission_id: c.id, status: "pending" });
    addCommission({ commission_cents: 130000 });
    h.fake!.tables.wa_affiliate_payouts.length = 0;   // fresh slate for the netting check
    const id2 = (await P.createPayoutRequest(AFF))!;
    expect(payouts().find(p => p.id === id2)!.amount_cents).toBe(50000);
  });
  it("a partial refund on an unclaimed commission holds it for review instead of voiding", async () => {
    addAffiliate(); const c = addCommission({ provider_payment_id: "pay_C" });
    expect(await P.applyPaymentReversal({ paymentId: "pay_C", event: "refund", refundAmount: 50, paymentAmount: 100 })).toBe("flagged");
    expect(c).toMatchObject({ status: "pending", flagged: true, flag_reason: "partial_refund" });
  });
  it("dispute opened holds the commission, won releases it, lost voids it", async () => {
    addAffiliate(); const c = addCommission({ provider_payment_id: "pay_D" });
    await P.applyPaymentReversal({ paymentId: "pay_D", event: "dispute_created" });
    expect(c.flagged).toBe(true);
    await P.applyPaymentReversal({ paymentId: "pay_D", event: "dispute_won" });
    expect(c.flagged).toBe(false);
    await P.applyPaymentReversal({ paymentId: "pay_D", event: "dispute_lost" });
    expect(c.status).toBe("void");
  });
  it("unknown payment is a no-op", async () => {
    addAffiliate(); expect(await P.applyPaymentReversal({ paymentId: "pay_none", event: "refund" })).toBe("no_commission");
  });
});

describe("payout details and validation webhook", () => {
  it("setPayoutDetails stores encrypted details, starts the cooldown, clears verification, emails the affiliate", async () => {
    addAffiliate({ payout_verified_at: ago(20), payout_changed_at: ago(30) });
    const out = await P.setPayoutDetails(AFF, { kind: "upi", vpa: "New.User@okhdfc" });
    const a = h.fake!.tables.wa_affiliates[0];
    expect(a.payout_verified_at).toBeNull(); expect(Date.now() - Date.parse(a.payout_changed_at as string)).toBeLessThan(5000);
    expect(a.rzpx_fund_account_id).toBe("fa_new"); expect(String(a.payout_details_enc)).toMatch(/^enc\(/); expect(a.payout_last4).toBe("user");
    expect(out.status).toBe("pending_verification");
    expect(JSON.stringify(out)).not.toMatch(/enc\(|okhdfc|payout_details_enc/);
    expect(h.emails.some(e => e.to === "asha@acme.io" && /payout account was changed/.test(e.subject))).toBe(true);
    addCommission({ commission_cents: 80000 });
    expect(await P.createPayoutRequest(AFF)).toBeNull();   // cooldown + unverified
  });
  it("rejects malformed destinations before touching RazorpayX", async () => {
    addAffiliate();
    await expect(P.setPayoutDetails(AFF, { kind: "upi", vpa: "nope" })).rejects.toThrow(/UPI/);
    await expect(P.setPayoutDetails(AFF, { kind: "bank", accountNumber: "1", ifsc: "SBIN0001234" })).rejects.toThrow(/account number/);
    await expect(P.setPayoutDetails(AFF, { kind: "bank", accountNumber: "123456789012", ifsc: "bad" })).rejects.toThrow(/IFSC/);
    expect(X.createContact).not.toHaveBeenCalled();
  });
  const val = (over: Record<string, unknown>) => ({ event: "fund_account.validation.completed", payload: { "fund_account.validation": { entity: { id: "fav_1", status: "completed", fund_account: { id: "fa_1" }, results: { account_status: "active", registered_name: "ASHA RAO", ...over } } } } });
  it("verifies only when the registered name matches", async () => {
    addAffiliate({ payout_verified_at: null, payout_changed_at: ago(1) });
    expect((await P.handleFundAccountValidationWebhook(val({}))).outcome).toBe("verified");
    expect(h.fake!.tables.wa_affiliates[0].payout_verified_at).toBeTruthy();
  });
  it("leaves it unverified and notes the owner on a name mismatch", async () => {
    addAffiliate({ payout_verified_at: null, payout_changed_at: ago(1) });
    expect((await P.handleFundAccountValidationWebhook(val({ registered_name: "SOMEONE ELSE" }))).outcome).toBe("needs_review");
    const a = h.fake!.tables.wa_affiliates[0]; expect(a.payout_verified_at).toBeNull(); expect(String(a.risk_note)).toMatch(/mismatch/i);
  });
  it("ignores a validation for a replaced fund account", async () => {
    addAffiliate({ payout_verified_at: null });
    const r = await P.handleFundAccountValidationWebhook({ event: "fund_account.validation.completed", payload: { "fund_account.validation": { entity: { fund_account: { id: "fa_old" }, results: { account_status: "active", registered_name: "ASHA RAO" } } } } });
    expect(r.handled).toBe(false); expect(h.fake!.tables.wa_affiliates[0].payout_verified_at).toBeNull();
  });
});

describe("owner controls", () => {
  it("clear-flag needs a note, only works on flagged rows, and is audited", async () => {
    addAffiliate(); const c = addCommission({ flagged: true, flag_reason: "same_email" });
    await expect(P.ownerClearFlag(c.id as string, "o", " ")).rejects.toThrow(/note/);
    await P.ownerClearFlag(c.id as string, "o", "checked, unrelated people");
    expect(c.flagged).toBe(false); expect(h.audit.some(a => a[1] === "affiliate.flag_cleared")).toBe(true);
    await expect(P.ownerClearFlag(c.id as string, "o", "again")).rejects.toThrow(/not flagged/);
  });
  it("risk hold blocks and releases claims and is audited", async () => {
    addAffiliate(); addCommission({ commission_cents: 80000 });
    await P.ownerSetRiskHold(AFF, true, "o", "chargebacks"); expect(await P.createPayoutRequest(AFF)).toBeNull();
    await P.ownerSetRiskHold(AFF, false, "o"); expect(await P.createPayoutRequest(AFF)).toBeTruthy();
    expect(h.audit.map(a => a[1])).toEqual(expect.arrayContaining(["affiliate.risk_hold_set", "affiliate.risk_hold_cleared"]));
  });
});

// ── manual mode: no RazorpayX; the owner pays by hand and records the reference ──
describe("manual payouts", () => {
  const VPA = "asha.rao@okhdfc";
  function manualAffiliate(over: Record<string, unknown> = {}) {
    addAffiliate({ rzpx_fund_account_id: "manual_11111111-1111-4111-8111-111111111111", payout_details_enc: `PLAIN:${JSON.stringify({ kind: "upi", vpa: VPA })}`, ...over });
  }
  async function approvedManual(cents = 80000) {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    manualAffiliate(); addCommission({ commission_cents: cents });
    const id = (await P.createPayoutRequest(AFF))!;
    const r = await P.approvePayout(id, "owner@x");
    expect(r).toEqual({ status: "processing", rzpPayoutId: null, manual: true });
    return id;
  }

  it("mode is manual until RazorpayX is configured; the env var can force either", () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    expect(P.payoutMode()).toBe("manual");
    process.env.RAZORPAYX_ACCOUNT_NUMBER = "2323230000000000";
    expect(P.payoutMode()).toBe("razorpayx");
    process.env.AFFILIATE_PAYOUT_MODE = "manual";
    expect(P.payoutMode()).toBe("manual");
  });

  it("saving payout details in manual mode calls no RazorpayX API and mints a fresh manual fund id each time", async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    addAffiliate({ rzpx_fund_account_id: null, payout_kind: null, payout_changed_at: null, payout_verified_at: null });
    await P.setPayoutDetails(AFF, { kind: "upi", vpa: VPA });
    const first = h.fake!.tables.wa_affiliates[0].rzpx_fund_account_id as string;
    expect(first).toMatch(/^manual_[0-9a-f-]{36}$/);
    expect(X.createContact).not.toHaveBeenCalled(); expect(X.createFundAccount).not.toHaveBeenCalled(); expect(X.startFundAccountValidation).not.toHaveBeenCalled();
    expect(h.fake!.tables.wa_affiliates[0].payout_verified_at).toBeNull();
    expect(String(h.fake!.tables.wa_affiliates[0].risk_note)).toMatch(/Manual verification/);
    await P.setPayoutDetails(AFF, { kind: "upi", vpa: "other@okicici" });
    expect(h.fake!.tables.wa_affiliates[0].rzpx_fund_account_id).not.toBe(first);
  });

  it("approval runs every check but sends nothing, and marks the payout manual", async () => {
    const id = await approvedManual();
    expect(X.createPayout).not.toHaveBeenCalled();
    expect(payouts()[0]).toMatchObject({ status: "processing", rzp_payout_id: null, approved_by: "owner@x" });
    expect((payouts()[0].payout_snapshot as { mode?: string }).mode).toBe("manual");
    expect(h.audit.some(a => a[1] === "affiliate.payout_approved_manual")).toBe(true);
    const listed = (await P.listOwnerPayoutData()).payouts.find(p => p.id === id)!;
    expect(listed.manual).toBe(true);
  });

  it("a manual fund id is never sent to RazorpayX, even after RazorpayX is configured", async () => {
    manualAffiliate(); addCommission();
    const id = (await P.createPayoutRequest(AFF))!;
    const r = await P.approvePayout(id, "o");   // RAZORPAYX_ACCOUNT_NUMBER is set in beforeEach
    expect(r.manual).toBe(true);
    expect(X.createPayout).not.toHaveBeenCalled();
  });

  it("manual approval still refuses a risk hold added after the request", async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    manualAffiliate(); addCommission();
    const id = (await P.createPayoutRequest(AFF))!;
    h.fake!.tables.wa_affiliates[0].risk_hold = true;
    await expect(P.approvePayout(id, "o")).rejects.toThrow(/risk_hold/);
    expect(payouts()[0].status).toBe("awaiting_approval");
  });

  it("payment details: full UPI ID and a UPI link with the exact amount, audited", async () => {
    const id = await approvedManual(80000);
    const i = await P.getManualPaymentInstructions(id, "owner@x");
    expect(i).toMatchObject({ kind: "upi", vpa: VPA, name: "Asha Rao", amountCents: 80000, accountNumber: null });
    expect(i.upiLink).toContain(`pa=${encodeURIComponent(VPA)}`);
    expect(i.upiLink).toContain("am=800.00");
    expect(i.upiLink).toContain("cu=INR");
    expect(h.audit.some(a => a[1] === "affiliate.payout_details_viewed")).toBe(true);
  });

  it("payment details are refused if the payout account changed after approval", async () => {
    const id = await approvedManual();
    h.fake!.tables.wa_affiliates[0].rzpx_fund_account_id = "manual_22222222-2222-4222-8222-222222222222";
    await expect(P.getManualPaymentInstructions(id, "o")).rejects.toThrow(/changed after approval/);
  });

  it("payment details are refused for a payout that is not an approved manual one", async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    manualAffiliate(); addCommission();
    const id = (await P.createPayoutRequest(AFF))!;   // still awaiting approval
    await expect(P.getManualPaymentInstructions(id, "o")).rejects.toThrow(/approved manual payout/);
  });

  it("recording the reference marks the payout and its commissions paid and emails the affiliate, once", async () => {
    const id = await approvedManual();
    await expect(P.recordManualPayment(id, "abc", "o")).rejects.toThrow(/UTR/);
    await P.recordManualPayment(id, " 4123 5678 9012 ", "owner@x");
    expect(payouts()[0]).toMatchObject({ status: "paid", utr: "412356789012" });
    expect(h.fake!.tables.wa_affiliate_commissions.every(c => c.status === "paid")).toBe(true);
    expect(h.emails.some(e => /payout was sent/.test(e.subject))).toBe(true);
    await expect(P.recordManualPayment(id, "412356789012", "o")).rejects.toThrow(/already recorded as paid/);
    expect(h.emails.filter(e => /payout was sent/.test(e.subject)).length).toBe(1);
  });

  it("one reference number cannot settle two payouts", async () => {
    const id = await approvedManual();
    payouts().push({ id: crypto.randomUUID(), affiliate_id: AFF, amount_cents: 1, status: "paid", utr: "412356789012" });
    await expect(P.recordManualPayment(id, "412356789012", "o")).rejects.toThrow(/another payout/);
    expect(payouts()[0].status).toBe("processing");
  });

  it("cancelling an unpaid manual payout needs the confirmation phrase and releases the commissions", async () => {
    const id = await approvedManual();
    await expect(P.cancelManualPayout(id, "o", "bank down", "yes")).rejects.toThrow(/NOT PAID/);
    await P.cancelManualPayout(id, "o", "bank down", "NOT PAID");
    expect(payouts()[0].status).toBe("cancelled");
    expect(h.fake!.tables.wa_affiliate_commissions[0]).toMatchObject({ status: "pending", payout_id: null });
    await expect(P.recordManualPayment(id, "412356789012", "o")).rejects.toThrow(/approved manual payout/);
  });

  it("a paid manual payout cannot be cancelled (no double payment)", async () => {
    const id = await approvedManual();
    await P.recordManualPayment(id, "412356789012", "o");
    await expect(P.cancelManualPayout(id, "o", "oops", "NOT PAID")).rejects.toThrow(/unpaid manual payout/);
    expect(payouts()[0].status).toBe("paid");
  });
});

describe("verification details (Rs 1 check before Verify)", () => {
  const VPA = "asha.rao@okhdfc";
  const unverified = (over: Record<string, unknown> = {}) => addAffiliate({ rzpx_fund_account_id: "manual_33333333-3333-4333-8333-333333333333",
    payout_details_enc: `PLAIN:${JSON.stringify({ kind: "upi", vpa: VPA })}`, payout_verified_at: null, payout_changed_at: ago(1), ...over });

  it("shows the full UPI ID and a Rs 1 UPI link for an unverified account, audited", async () => {
    unverified();
    const d = await P.getVerificationDetails(AFF, "owner@x");
    expect(d).toMatchObject({ kind: "upi", vpa: VPA, amountCents: 100, accountNumber: null });
    expect(d.upiLink).toContain("am=1.00");
    expect(h.audit.some(a => a[1] === "affiliate.payout_details_viewed_for_verification")).toBe(true);
  });
  it("is refused once the account is verified (no browsing stored details)", async () => {
    unverified({ payout_verified_at: ago(0) });
    await expect(P.getVerificationDetails(AFF, "o")).rejects.toThrow(/already verified/);
  });
  it("is refused for a suspended affiliate or one with no account", async () => {
    unverified({ status: "suspended" });
    await expect(P.getVerificationDetails(AFF, "o")).rejects.toThrow(/not active/);
    h.fake!.tables.wa_affiliates[0] = { ...h.fake!.tables.wa_affiliates[0], status: "active", payout_kind: null };
    await expect(P.getVerificationDetails(AFF, "o")).rejects.toThrow(/no payout account/);
  });
  it("owner list marks a payout pay-by-hand in manual mode, before approval", async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER;
    addAffiliate({ rzpx_fund_account_id: "manual_44444444-4444-4444-8444-444444444444" }); addCommission();
    const id = (await P.createPayoutRequest(AFF))!;
    const row = (await P.listOwnerPayoutData()).payouts.find(p => p.id === id)!;
    expect(row).toMatchObject({ status: "awaiting_approval", manual: false, payByHand: true });
  });
});
