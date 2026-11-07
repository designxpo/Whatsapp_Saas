// Multi-month plans: seeded price math, Razorpay interval handling, eligibility
// of invite-only / partner plans (listing + checkout), and 6-month consent text.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  tenant: { id: "t1", ownerEmail: "owner@acme.test", paymentProvider: null, currentPeriodEnd: null, paymentStatus: "trialing", plan: "trial" } as Record<string, unknown>,
  plans: [] as Record<string, unknown>[],
  rzp: { amountCents: 0, period: "monthly", interval: 1 },
  subs: [] as unknown[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const rows = () => (h.tables[table] ?? []).filter(r => filters.every(f => f(r)));
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (k: string, v: unknown) => { filters.push(r => r[k] === v); return b; };
      b.in = (k: string, vs: unknown[]) => { filters.push(r => vs.includes(r[k])); return b; };
      b.lte = (k: string, v: string) => { filters.push(r => typeof r[k] === "string" && (r[k] as string) <= v); return b; };
      b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
      return b;
    },
  }),
}));

vi.mock("../auth", () => ({
  requireRoleAdmin: async () => true,
  currentTenantId: async () => "t1",
  currentUser: async () => ({ email: "owner@acme.test" }),
  noSession: () => new Response("{}", { status: 401 }),
}));
vi.mock("../tenants", () => ({
  getTenant: async () => h.tenant,
  ownerAudit: async () => {},
  hasBillingIdentity: () => true,
  setRazorpayIds: async () => {},
}));
vi.mock("../plans", async () => {
  const actual = await vi.importActual<typeof import("../plans")>("../plans");
  return {
    ...actual,
    listPlans: async () => h.plans,
    getPlan: async (k: string) => h.plans.find(p => p.key === k) ?? null,
    setRazorpayPlanId: async () => {},
  };
});
vi.mock("../stripe", () => ({ stripeConfigured: () => false, getStripePriceSummary: async () => null }));
vi.mock("../billing-cancel", () => ({
  billingProvider: () => null, hasLiveSubscription: () => false, readCancelAt: async () => null,
}));
vi.mock("../razorpay", async () => {
  const actual = await vi.importActual<typeof import("../razorpay")>("../razorpay");
  return {
    ...actual,
    razorpayConfigured: () => true,
    resolveRazorpayPlan: async () => ({ planId: "plan_x", currency: "INR", ...h.rzp }),
    createSubscription: async (...a: unknown[]) => { h.subs.push(a); return { subscriptionId: "sub_1", shortUrl: "" }; },
  };
});

import { multiMonthPriceCents, savingsPercent } from "../plans";
import { computeChargeBreakdown } from "../billing-tax";
import { canPurchasePlan, filterPurchasablePlans, countConvertedReferrals, partnerMinConverted } from "../plan-eligibility";
import { autoRenewStatement, autoRenewAckLabel, autoRenewAckDetail } from "../billing-consent";

const plan = (key: string, over: Record<string, unknown> = {}) => ({
  key, name: key, priceCents: 99_900, currency: "INR", interval: "month", billingMonths: 1, inviteOnly: false, active: true,
  limits: {}, features: {}, sort: 0, stripePriceId: null, razorpayPlanId: null, ...over,
});

beforeEach(() => {
  h.tables = {}; h.subs = [];
  h.tenant = { id: "t1", ownerEmail: "owner@acme.test", paymentProvider: null, currentPeriodEnd: null, paymentStatus: "trialing", plan: "trial" };
  delete process.env.PARTNER_MIN_CONVERTED;
});

describe("seeded price math (mirrors migration 20261107130000)", () => {
  it("Creator 99,900 / Creator Pro 299,900 paise", () => {
    expect(multiMonthPriceCents(99_900, 6, 10)).toBe(539_460);
    expect(multiMonthPriceCents(299_900, 6, 10)).toBe(1_619_460);
    expect(multiMonthPriceCents(99_900, 6, 20)).toBe(479_520);
    expect(multiMonthPriceCents(299_900, 6, 20)).toBe(1_439_520);
  });
  it("rounds to whole paise", () => {
    expect(Number.isInteger(multiMonthPriceCents(12_345, 6, 10))).toBe(true);
  });
  it("savings are measured per month against the monthly plan", () => {
    expect(savingsPercent(99_900, 539_460, 6)).toBe(10);
    expect(savingsPercent(99_900, 479_520, 6)).toBe(20);
    expect(savingsPercent(0, 100, 6)).toBe(0);
  });
  it("charge breakdown is computed on the whole-period base", () => {
    const b = computeChargeBreakdown(539_460);
    expect(b.baseAmountCents).toBe(539_460);
    expect(b.totalChargedCents % 100).toBe(0);
    expect(b.totalChargedCents).toBeGreaterThan(539_460);
  });
});

describe("resolveRazorpayPlan interval", () => {
  const realFetch = global.fetch;
  let calls: { url: string; body: Record<string, unknown> | null }[];
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "k"; process.env.RAZORPAY_KEY_SECRET = "s";
    calls = [];
  });
  afterEach(() => { global.fetch = realFetch; });
  const mockFetch = (reply: unknown) => {
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;
  };

  it("mints a 6-month plan as monthly / interval 6", async () => {
    const real = await vi.importActual<typeof import("../razorpay")>("../razorpay");
    mockFetch({ id: "plan_new" });
    const r = await real.resolveRazorpayPlan(plan("creator-6m", { billingMonths: 6, priceCents: 539_460 }) as never);
    expect(calls[0].body).toMatchObject({ period: "monthly", interval: 6 });
    expect(r).toMatchObject({ planId: "plan_new", period: "monthly", interval: 6, amountCents: computeChargeBreakdown(539_460).totalChargedCents });
  });
  it("a single-month plan is still interval 1", async () => {
    const real = await vi.importActual<typeof import("../razorpay")>("../razorpay");
    mockFetch({ id: "plan_new" });
    const r = await real.resolveRazorpayPlan(plan("creator") as never);
    expect(calls[0].body).toMatchObject({ period: "monthly", interval: 1 });
    expect(r.interval).toBe(1);
  });
  it("reads a cached plan's real interval back", async () => {
    const real = await vi.importActual<typeof import("../razorpay")>("../razorpay");
    mockFetch({ id: "plan_c", period: "monthly", interval: 6, item: { amount: 5_70_000, currency: "INR" } });
    const r = await real.resolveRazorpayPlan(plan("creator-6m", { billingMonths: 6, razorpayPlanId: "plan_c" }) as never);
    expect(r).toMatchObject({ interval: 6, amountCents: 570_000 });
  });
  it("total_count keeps every mandate within 30 years", async () => {
    const real = await vi.importActual<typeof import("../razorpay")>("../razorpay");
    expect(real.indefiniteCycles(1)).toBe(360);
    expect(real.indefiniteCycles(6)).toBe(60);
    expect(real.indefiniteCycles(12)).toBe(30);
    expect(real.indefiniteCycles(3)).toBe(120);
  });
});

describe("eligibility", () => {
  const t = { id: "t1", ownerEmail: "Owner@Acme.test" };
  const PAST = "2020-01-01T00:00:00.000Z", FUTURE = "2099-01-01T00:00:00.000Z";
  // Each referred tenant gets one settled (unflagged, past-hold) earning by
  // default; `commission` overrides it per tenant, `null` means none at all.
  const setup = (referred: (Record<string, unknown> & { commission?: Record<string, unknown> | null })[], affStatus = "active") => {
    h.tables.wa_affiliates = [{ id: "a1", email: "owner@acme.test", status: affStatus }];
    h.tables.tenants = referred.map((r, i) => { const { commission: _c, ...t } = r; return { id: `r${i}`, referred_by_affiliate_id: "a1", status: "active", payment_status: "active", owner_email: `c${i}@x.test`, ...t }; });
    h.tables.wa_affiliate_commissions = referred.flatMap((r, i) => r.commission === null ? [] : [{ affiliate_id: "a1", tenant_id: `r${i}`, kind: "earning", flagged: false, status: "paid", payable_at: PAST, ...(r.commission ?? {}) }]);
  };

  it("non-invite-only plans are always purchasable", async () => {
    expect(await canPurchasePlan(t, plan("creator"))).toBe(true);
  });
  it("invite-only without a grant is refused; with a grant it is allowed", async () => {
    const p = plan("creator-6m", { inviteOnly: true });
    expect(await canPurchasePlan(t, p)).toBe(false);
    h.tables.wa_plan_grants = [{ tenant_id: "t1", plan_key: "creator-6m" }];
    expect(await canPurchasePlan(t, p)).toBe(true);
    expect(await canPurchasePlan({ id: "t2", ownerEmail: null }, p)).toBe(false);
  });
  it("a grant for one plan does not unlock another", async () => {
    h.tables.wa_plan_grants = [{ tenant_id: "t1", plan_key: "creator-6m" }];
    expect(await canPurchasePlan(t, plan("creator-pro-6m", { inviteOnly: true }))).toBe(false);
  });
  it("partner plan: threshold met -> allowed, not met -> refused", async () => {
    const p = plan("creator-6m-partner", { inviteOnly: true });
    setup([{}, {}]);
    expect(await canPurchasePlan(t, p)).toBe(false);
    setup([{}, {}, {}]);
    expect(await canPurchasePlan(t, p)).toBe(true);
  });
  it("partner threshold: env override, inactive affiliate, non-active/suspended referrals", async () => {
    const p = plan("creator-6m-partner", { inviteOnly: true });
    process.env.PARTNER_MIN_CONVERTED = "1";
    expect(partnerMinConverted()).toBe(1);
    setup([{}]);
    expect(await canPurchasePlan(t, p)).toBe(true);
    setup([{}], "suspended");
    expect(await canPurchasePlan(t, p)).toBe(false);
    setup([{ payment_status: "trialing" }]);
    expect(await canPurchasePlan(t, p)).toBe(false);
    setup([{ status: "suspended" }]);
    expect(await canPurchasePlan(t, p)).toBe(false);
  });
  it("partner plan: only referrals with a settled, unflagged commission count", async () => {
    const p = plan("creator-6m-partner", { inviteOnly: true });
    setup([{}, {}, { commission: { flagged: true } }]);
    expect(await canPurchasePlan(t, p)).toBe(false);          // flagged (e.g. self-referral) does not count
    setup([{}, {}, { commission: { payable_at: FUTURE } }]);
    expect(await canPurchasePlan(t, p)).toBe(false);          // still inside the 10-day refund hold
    setup([{}, {}, { commission: { status: "void" } }]);
    expect(await canPurchasePlan(t, p)).toBe(false);          // refunded
    setup([{}, {}, { commission: null }]);
    expect(await canPurchasePlan(t, p)).toBe(false);          // paying, but no commission recorded
    setup([{}, {}, { commission: { status: "pending" } }]);
    expect(await canPurchasePlan(t, p)).toBe(true);           // pending but past hold and clean
  });
  it("self-referred tenants are not counted", () => {
    const rows = [
      { status: "active", payment_status: "active", owner_email: "Owner@Acme.test" },
      { status: "active", payment_status: "active", owner_email: "c@x.test" },
    ];
    expect(countConvertedReferrals(rows, "owner@acme.test")).toBe(1);
  });
  it("a tenant whose owner is not an affiliate never qualifies as partner", async () => {
    setup([{}, {}, {}]);
    expect(await canPurchasePlan({ id: "t9", ownerEmail: "nobody@x.test" }, plan("creator-6m-partner", { inviteOnly: true }))).toBe(false);
  });
  it("partner qualification alone does not unlock a non-partner invite-only plan", async () => {
    setup([{}, {}, {}]);
    expect(await canPurchasePlan(t, plan("creator-6m", { inviteOnly: true }))).toBe(false);
  });
  it("filterPurchasablePlans hides what the tenant cannot buy", async () => {
    const all = [plan("creator"), plan("creator-6m", { inviteOnly: true }), plan("creator-6m-partner", { inviteOnly: true })];
    expect((await filterPurchasablePlans(t, all)).map(p => p.key)).toEqual(["creator"]);
    h.tables.wa_plan_grants = [{ tenant_id: "t1", plan_key: "creator-6m" }];
    expect((await filterPurchasablePlans(t, all)).map(p => p.key)).toEqual(["creator", "creator-6m"]);
    expect((await filterPurchasablePlans(null, all)).map(p => p.key)).toEqual(["creator"]);
  });
});

describe("billing GET listing", () => {
  it("never leaks invite-only plans to an ineligible tenant, and derives per-month from the monthly plan", async () => {
    const { GET } = await import("../../app/api/admin/billing/route");
    h.plans = [
      plan("creator"),
      plan("creator-pro", { priceCents: 299_900 }),
      plan("creator-6m", { priceCents: 539_460, billingMonths: 6, inviteOnly: true }),
      plan("creator-pro-6m", { priceCents: 1_619_460, billingMonths: 6, inviteOnly: true }),
    ];
    let d = await (await GET()).json();
    expect(d.plans.map((p: { key: string }) => p.key)).toEqual(["creator", "creator-pro"]);
    expect(JSON.stringify(d)).not.toContain("6m");

    h.tables.wa_plan_grants = [{ tenant_id: "t1", plan_key: "creator-pro-6m" }];
    d = await (await GET()).json();
    const p6 = d.plans.find((p: { key: string }) => p.key === "creator-pro-6m");
    expect(p6.billingMonths).toBe(6);
    expect(p6.savingsPercent).toBe(10);   // based on creator-pro, not creator
    expect(p6.perMonthCents).toBe(Math.round(p6.totalChargedCents / 6));
    expect(d.plans.find((p: { key: string }) => p.key === "creator").billingMonths).toBe(1);
  });
});

describe("razorpay checkout", () => {
  const post = async (planKey: string, extra: Record<string, unknown> = {}) => {
    const { POST } = await import("../../app/api/admin/billing/razorpay/checkout/route");
    return POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ planKey, autoRenewAck: true, ...extra }) }));
  };
  it("rejects a hand-typed invite-only planKey with 403 and creates nothing", async () => {
    h.plans = [plan("creator-6m", { priceCents: 539_460, billingMonths: 6, inviteOnly: true })];
    const res = await post("creator-6m");
    expect(res.status).toBe(403);
    expect(h.subs).toHaveLength(0);
  });
  it("a granted 6-month plan checks the plan's own interval and says '/6 months'", async () => {
    h.plans = [plan("creator-6m", { priceCents: 539_460, billingMonths: 6, inviteOnly: true })];
    h.tables.wa_plan_grants = [{ tenant_id: "t1", plan_key: "creator-6m" }];
    const shown = computeChargeBreakdown(539_460).totalChargedCents;
    h.rzp = { amountCents: shown, period: "monthly", interval: 1 };   // a stale monthly Razorpay Plan
    let res = await post("creator-6m");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("/6 months");
    expect(h.subs).toHaveLength(0);
    h.rzp = { amountCents: shown, period: "monthly", interval: 6 };
    res = await post("creator-6m", { displayedAmountCents: shown });
    expect(res.status).toBe(200);
    expect(h.subs).toHaveLength(1);
  });
});

describe("consent text for 6 months", () => {
  it("states the six-month cadence", () => {
    expect(autoRenewStatement("₹5,700", "month", 6)).toBe("Renews automatically every 6 months at ₹5,700 until you cancel. Cancel anytime from this page.");
    expect(autoRenewAckLabel("month", 6)).toBe("I understand this renews automatically every 6 months until I cancel");
    expect(autoRenewAckDetail({ planKey: "creator-6m", provider: "razorpay", amountCents: 570_000, currency: "INR", interval: "month", intervalCount: 6, at: new Date(0) }))
      .toContain("every 6 months");
  });
  it("single-month wording is unchanged", () => {
    expect(autoRenewStatement("₹1,023")).toContain("every month");
  });
});
