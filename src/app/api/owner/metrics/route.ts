import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { platformStatsFast, planMix, signupsByDay } from "@/lib/ownermetrics";
import { db } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the business view. Entirely missing from the old portal, which showed a
// tenant count, an MRR number and a signup sparkline and nothing else: no sense
// of whether revenue was growing, whether trials convert, or where churn comes
// from.
//
// Every figure here is a SQL aggregate, so the cost is flat in fleet size.
export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days")) || 90, 7), 365);
  try {
    const [stats, plans, signups, funnel, churn, gatewayFees] = await Promise.all([
      platformStatsFast(),
      planMix(),
      signupsByDay(days),
      conversionFunnel(),
      churnBuckets(),
      gatewayFeesInWindow(days),
    ]);

    // Revenue per plan tells you where the money actually is — a plan with a
    // handful of tenants can outweigh one with hundreds.
    const { data: revRows } = await db().from("tenants")
      .select("plan,amount_cents").eq("payment_status", "active");
    const revenueByPlan = new Map<string, { plan: string; tenants: number; mrrCents: number }>();
    for (const r of (revRows ?? []) as { plan: string; amount_cents: number }[]) {
      const e = revenueByPlan.get(r.plan) ?? { plan: r.plan, tenants: 0, mrrCents: 0 };
      e.tenants++; e.mrrCents += r.amount_cents ?? 0;
      revenueByPlan.set(r.plan, e);
    }

    return NextResponse.json({
      stats,
      planMix: plans,
      signupsByDay: signups,
      revenueByPlan: [...revenueByPlan.values()].sort((a, b) => b.mrrCents - a.mrrCents),
      funnel,
      churn,
      gatewayFees,
      arpuCents: stats.active > 0 ? Math.round(stats.mrrCents / stats.active) : 0,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Signup → trial → paid, as counts. Derived from payment_status rather than an
 * event stream, so it's a snapshot of where accounts stand today rather than a
 * true cohort conversion — honest enough to steer by, and it costs four indexed
 * COUNTs instead of a table scan.
 */
async function conversionFunnel(): Promise<{ signups: number; trialing: number; paid: number; lapsed: number }> {
  const count = async (build: (q: ReturnType<typeof db>) => PromiseLike<{ count: number | null }>) =>
    (await build(db())).count ?? 0;
  const [signups, trialing, paid, lapsed] = await Promise.all([
    count(d => d.from("tenants").select("id", { count: "exact", head: true })),
    count(d => d.from("tenants").select("id", { count: "exact", head: true }).eq("payment_status", "trialing")),
    count(d => d.from("tenants").select("id", { count: "exact", head: true }).eq("payment_status", "active")),
    count(d => d.from("tenants").select("id", { count: "exact", head: true }).in("payment_status", ["past_due", "cancelled"])),
  ]);
  return { signups, trialing, paid, lapsed };
}

/**
 * What Razorpay actually took vs. the checkout-time ESTIMATE, over the window.
 * Real fee/tax is only known once a subscription.charged webhook reports it
 * (src/app/api/webhooks/razorpay/subscriptions/route.ts) — rows still waiting
 * on that fall back to their estimate, so "net" is always a real number, never
 * partially null.
 */
async function gatewayFeesInWindow(days: number): Promise<{ chargedCents: number; feesCents: number; netCents: number }> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data } = await db().from("wa_billing_events")
    .select("total_charged_cents, gateway_fee_estimate_cents, gateway_fee_actual_cents, gateway_tax_actual_cents")
    .gte("created_at", since);
  const rows = (data ?? []) as { total_charged_cents: number; gateway_fee_estimate_cents: number; gateway_fee_actual_cents: number | null; gateway_tax_actual_cents: number | null }[];
  let chargedCents = 0, feesCents = 0;
  for (const r of rows) {
    chargedCents += r.total_charged_cents;
    feesCents += r.gateway_fee_actual_cents != null
      ? r.gateway_fee_actual_cents + (r.gateway_tax_actual_cents ?? 0)
      : r.gateway_fee_estimate_cents;
  }
  return { chargedCents, feesCents, netCents: chargedCents - feesCents };
}

/** Where accounts are leaking: past due, cancelled, or a trial that ran out unpaid. */
async function churnBuckets(): Promise<{ pastDue: number; cancelled: number; trialLapsed: number }> {
  const now = new Date().toISOString();
  const [pastDue, cancelled, trialLapsed] = await Promise.all([
    db().from("tenants").select("id", { count: "exact", head: true }).eq("payment_status", "past_due"),
    db().from("tenants").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
    db().from("tenants").select("id", { count: "exact", head: true })
      .lt("trial_ends_at", now).in("payment_status", ["trialing", "none"])
      .not("status", "in", "(suspended,cancelled)"),
  ]);
  return { pastDue: pastDue.count ?? 0, cancelled: cancelled.count ?? 0, trialLapsed: trialLapsed.count ?? 0 };
}
