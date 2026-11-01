// Subscription cancellation and renewal consent. What must hold:
//  - an admin can cancel a Razorpay subscription from the billing page; it is
//    cancelled at the END of the cycle and access is left alone until then;
//  - a second cancel (double click, retry, already cancelled at Razorpay) is a
//    calm 200 with the same date, never an error or a second API call;
//  - no checkout starts without the explicit auto-renewal acknowledgement, and
//    the acknowledgement is recorded with what was agreed and when;
//  - checkout never opens at a price other than the one shown;
//  - the webhook ends access when Razorpay says the subscription has ended,
//    not on an event that arrives while it is still running.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import type { Tenant } from "../tenants";

const h = vi.hoisted(() => ({
  role: "admin" as string | null,
  tenant: null as Record<string, unknown> | null,
  cancelAtColumn: undefined as string | null | undefined,   // undefined → column missing (migration not applied)
  auditRows: [] as { detail: string }[],
  audits: [] as { action: string; detail: string }[],
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  applied: [] as Record<string, unknown>[],
  plan: { key: "starter", name: "Starter", priceCents: 199_900, currency: "INR", razorpayPlanId: "plan_cached" } as Record<string, unknown>,
}));

vi.mock("../auth", () => ({
  requireRoleAdmin: async () => h.role === "admin",
  currentTenantId: async () => (h.role ? "t1" : null),
  currentUser: async () => (h.role ? { email: "owner@acme.test", role: h.role } : null),
  DEFAULT_TENANT_ID: "t-default",
}));

vi.mock("../tenants", () => ({
  getTenant: async () => h.tenant,
  getTenantByRazorpaySubscription: async (id: string) => (h.tenant && h.tenant.razorpaySubscriptionId === id ? h.tenant : null),
  ownerAudit: async (_actor: string, action: string, _tid: string, detail = "") => { h.audits.push({ action, detail }); },
  hasBillingIdentity: () => true,
  setRazorpayIds: async () => {},
  applySubscription: async (_tid: string, p: Record<string, unknown>) => { h.applied.push(p); },
}));

vi.mock("../plans", () => ({
  getPlan: async () => h.plan,
  setRazorpayPlanId: async () => {},
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      let op = "select";
      let payload: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ["select", "eq", "order", "limit", "is"]) b[m] = self;
      b.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return b; };
      const missing = { data: null, error: { code: "42703", message: 'column tenants.subscription_cancel_at does not exist' } };
      const result = () => {
        if (table === "tenants" && op === "update") {
          if (h.cancelAtColumn === undefined) return { data: null, error: { code: "PGRST204", message: "Could not find the 'subscription_cancel_at' column" } };
          h.updates.push({ table, payload });
          h.cancelAtColumn = payload.subscription_cancel_at as string | null;
          return { data: null, error: null };
        }
        if (table === "tenants") return h.cancelAtColumn === undefined ? missing : { data: { subscription_cancel_at: h.cancelAtColumn }, error: null };
        if (table === "wa_owner_audit") return { data: h.auditRows, error: null };
        return { data: null, error: null };
      };
      b.maybeSingle = () => Promise.resolve(result());
      b.single = () => Promise.resolve(result());
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return b;
    },
  }),
}));

vi.mock("../billing-events", () => ({ recordBillingEvent: async () => "be1", recordActualGatewayFee: async () => {} }));
vi.mock("../invoice-email", () => ({ sendInvoiceEmail: async () => {} }));
vi.mock("../dunning", () => ({ notifyPaymentFailed: async () => {}, notifyServiceSuspended: async () => {} }));

type FetchCall = { url: string; method: string; body: unknown; auth: string | null };
let fetchCalls: FetchCall[] = [];
let fetchReply: (url: string, method: string) => { status: number; body: unknown };

function tenant(over: Partial<Tenant> = {}): Record<string, unknown> {
  return {
    id: "t1", name: "Acme", plan: "starter", status: "active", paymentStatus: "active", paymentProvider: "razorpay",
    razorpaySubscriptionId: "sub_1", razorpayCustomerId: null, stripeCustomerId: null, stripeSubscriptionId: null,
    currentPeriodEnd: "2026-12-01T00:00:00.000Z", trialEndsAt: null, ownerEmail: null,
    ...over,
  };
}

beforeEach(() => {
  h.role = "admin"; h.tenant = tenant(); h.cancelAtColumn = null;
  h.auditRows = []; h.audits = []; h.updates = []; h.applied = [];
  h.plan = { key: "starter", name: "Starter", priceCents: 199_900, currency: "INR", razorpayPlanId: "plan_cached" };
  fetchCalls = [];
  fetchReply = () => ({ status: 200, body: {} });
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    fetchCalls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization ?? null });
    const r = fetchReply(url, method);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const cancelRoute = await import("../../app/api/admin/billing/cancel/route");
const rzpCheckout = await import("../../app/api/admin/billing/razorpay/checkout/route");
const stripeCheckout = await import("../../app/api/admin/billing/checkout/route");
const webhook = await import("../../app/api/webhooks/razorpay/subscriptions/route");

const CYCLE_END = Date.parse("2026-12-01T00:00:00.000Z") / 1000;

describe("cancel a Razorpay subscription", () => {
  it("is admin-only", async () => {
    h.role = "agent";
    const res = await cancelRoute.POST();
    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("cancels at the end of the cycle, records when access ends, and leaves access alone", async () => {
    fetchReply = () => ({ status: 200, body: { id: "sub_1", status: "active", current_end: CYCLE_END, ended_at: null } });
    const res = await cancelRoute.POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.endsAt).toBe("2026-12-01T00:00:00.000Z");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.razorpay.com/v1/subscriptions/sub_1/cancel");
    expect(fetchCalls[0].method).toBe("POST");
    expect(fetchCalls[0].body).toEqual({ cancel_at_cycle_end: 1 });
    expect(fetchCalls[0].auth).toBe(`Basic ${Buffer.from("rzp_test_key:rzp_test_secret").toString("base64")}`);

    expect(h.cancelAtColumn).toBe("2026-12-01T00:00:00.000Z");
    expect(h.audits.map(a => a.action)).toContain("billing.cancel_scheduled");
    // The plan stays exactly as it was — the webhook ends it when the cycle does.
    expect(h.applied).toHaveLength(0);
  });

  it("says plainly when there is nothing to cancel", async () => {
    h.tenant = tenant({ paymentProvider: null, razorpaySubscriptionId: null, paymentStatus: "trialing" });
    const res = await cancelRoute.POST();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no active subscription/i);
    expect(fetchCalls).toHaveLength(0);
  });

  it("does not treat an unpaid checkout (subscription id, never paid) as a subscription", async () => {
    h.tenant = tenant({ paymentProvider: null, paymentStatus: "trialing" });   // id stamped when the modal opened
    const res = await cancelRoute.POST();
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("sends Stripe subscriptions to the portal instead", async () => {
    h.tenant = tenant({ paymentProvider: null, razorpaySubscriptionId: null, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_stripe" });
    const res = await cancelRoute.POST();
    expect(res.status).toBe(400);
    expect((await res.json()).provider).toBe("stripe");
  });

  it("is idempotent once a cancel is recorded — no second Razorpay call", async () => {
    h.cancelAtColumn = "2026-12-01T00:00:00.000Z";
    const res = await cancelRoute.POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d).toMatchObject({ ok: true, alreadyScheduled: true, endsAt: "2026-12-01T00:00:00.000Z" });
    expect(fetchCalls).toHaveLength(0);
  });

  it("is idempotent when the workspace's subscription has already ended", async () => {
    h.tenant = tenant({ paymentStatus: "cancelled", status: "cancelled" });
    const res = await cancelRoute.POST();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyCancelled).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });

  it("treats Razorpay's 'already cancelled' 400 as done, reading the dates back", async () => {
    fetchReply = (url, method) => method === "POST"
      ? { status: 400, body: { error: { description: "Subscription is not cancellable in cancelled status." } } }
      : { status: 200, body: { id: "sub_1", status: "cancelled", current_end: CYCLE_END, ended_at: CYCLE_END } };
    const res = await cancelRoute.POST();
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d).toMatchObject({ ok: true, alreadyCancelled: true, endsAt: "2026-12-01T00:00:00.000Z" });
    expect(fetchCalls.map(c => c.method)).toEqual(["POST", "GET"]);
  });

  it("reports a Razorpay failure without recording a cancel", async () => {
    fetchReply = () => ({ status: 500, body: { error: { description: "Gateway timeout" } } });
    const res = await cancelRoute.POST();
    expect(res.status).toBe(502);
    expect(h.cancelAtColumn).toBeNull();
    expect(h.audits).toHaveLength(0);
  });

  it("works before the migration: falls back to the audit row, scoped to this subscription", async () => {
    h.cancelAtColumn = undefined;   // column missing
    fetchReply = () => ({ status: 200, body: { id: "sub_1", status: "active", current_end: CYCLE_END } });
    const first = await cancelRoute.POST();
    expect(first.status).toBe(200);
    const row = h.audits.find(a => a.action === "billing.cancel_scheduled")!;
    expect(row.detail).toMatch(/^sub_1 until 2026-12-01T00:00:00.000Z/);

    // Second click: the audit row is found, Razorpay isn't called again.
    h.auditRows = [{ detail: "sub_old until 2025-01-01T00:00:00.000Z" }, { detail: row.detail }];
    fetchCalls = [];
    const again = await cancelRoute.POST();
    expect((await again.json()).alreadyScheduled).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });
});

const post = (body: unknown) => new Request("http://app.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
// computeChargeBreakdown(₹1,999) → ₹2,047 all-inclusive
const SHOWN = 204_700;

describe("auto-renewal acknowledgement at checkout", () => {
  beforeEach(() => { h.tenant = tenant({ paymentProvider: null, razorpaySubscriptionId: null, paymentStatus: "trialing" }); });

  it("Razorpay: refuses without the acknowledgement, before touching Razorpay", async () => {
    for (const body of [{ planKey: "starter" }, { planKey: "starter", autoRenewAck: "true" }, { planKey: "starter", autoRenewAck: false }]) {
      const res = await rzpCheckout.POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).needsAutoRenewAck).toBe(true);
    }
    expect(fetchCalls).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("Stripe: refuses without the acknowledgement", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const res = await stripeCheckout.POST(post({ planKey: "starter" }));
    expect(res.status).toBe(400);
    expect((await res.json()).needsAutoRenewAck).toBe(true);
  });

  it("Razorpay: with it, records what was agreed and when, then creates the subscription", async () => {
    fetchReply = (url) => url.endsWith("/plans/plan_cached")
      ? { status: 200, body: { id: "plan_cached", period: "monthly", interval: 1, item: { amount: SHOWN, currency: "INR" } } }
      : { status: 200, body: { id: "sub_new", short_url: "https://rzp.io/x" } };
    const res = await rzpCheckout.POST(post({ planKey: "starter", autoRenewAck: true, displayedAmountCents: SHOWN }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d).toMatchObject({ subscriptionId: "sub_new", amountCents: SHOWN });

    const ack = h.audits.find(a => a.action === "billing.auto_renew_ack")!;
    expect(ack.detail).toContain("plan=starter");
    expect(ack.detail).toContain(`amount=${SHOWN} INR every month`);
    expect(ack.detail).toMatch(/at=\d{4}-\d\d-\d\dT/);
    expect(ack.detail).toContain("I understand this renews automatically every month until I cancel");
    // Recorded BEFORE the subscription exists.
    expect(h.audits.map(a => a.action)).toEqual(["billing.auto_renew_ack", "billing.razorpay_checkout"]);
    expect(fetchCalls.find(c => c.url.endsWith("/subscriptions"))?.body).toMatchObject({ plan_id: "plan_cached" });
  });

  it("Razorpay: never opens checkout at a different price than shown", async () => {
    // A stale cached Plan — e.g. one minted before a price change.
    fetchReply = () => ({ status: 200, body: { id: "plan_cached", period: "monthly", interval: 1, item: { amount: 241_600, currency: "INR" } } });
    const res = await rzpCheckout.POST(post({ planKey: "starter", autoRenewAck: true, displayedAmountCents: SHOWN }));
    expect(res.status).toBe(409);
    expect(fetchCalls.some(c => c.url.endsWith("/subscriptions"))).toBe(false);
  });

  it("Razorpay: refuses a second subscription while one is live (it would bill twice)", async () => {
    h.tenant = tenant();   // active Razorpay subscriber
    const res = await rzpCheckout.POST(post({ planKey: "starter", autoRenewAck: true, displayedAmountCents: SHOWN }));
    expect(res.status).toBe(409);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("subscription webhook — ending access", () => {
  const SECRET = "whsec_rzp_subs";
  const deliver = (event: string, entity: Record<string, unknown>) => {
    const raw = JSON.stringify({ event, payload: { subscription: { entity } } });
    const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    return webhook.POST(new Request("http://app.test/api/webhooks/razorpay/subscriptions", { method: "POST", headers: { "x-razorpay-signature": sig }, body: raw }));
  };
  beforeEach(() => { vi.stubEnv("RAZORPAY_SUBSCRIPTIONS_WEBHOOK_SECRET", SECRET); });

  it("ends access when Razorpay reports the subscription cancelled at cycle end", async () => {
    const res = await deliver("subscription.cancelled", { id: "sub_1", status: "cancelled", current_end: CYCLE_END, ended_at: CYCLE_END });
    expect(res.status).toBe(200);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]).toMatchObject({ paymentStatus: "cancelled", status: "cancelled", subscriptionId: "sub_1" });
    expect(h.cancelAtColumn).toBe("2026-12-01T00:00:00.000Z");
  });

  it("treats subscription.completed the same way", async () => {
    await deliver("subscription.completed", { id: "sub_1", status: "completed", current_end: CYCLE_END, ended_at: CYCLE_END });
    expect(h.applied[0]).toMatchObject({ paymentStatus: "cancelled", status: "cancelled" });
  });

  it("does not cut off paid time on an ending event that says the subscription is still running", async () => {
    await deliver("subscription.cancelled", { id: "sub_1", status: "active", current_end: CYCLE_END });
    expect(h.applied).toHaveLength(0);
  });

  it("ignores events for a subscription that isn't the workspace's", async () => {
    await deliver("subscription.cancelled", { id: "sub_other", status: "cancelled", ended_at: CYCLE_END });
    expect(h.applied).toHaveLength(0);
  });

  it("rejects an unsigned delivery", async () => {
    const res = await webhook.POST(new Request("http://app.test/x", { method: "POST", headers: { "x-razorpay-signature": "nope" }, body: "{}" }));
    expect(res.status).toBe(401);
  });
});
