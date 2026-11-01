// Cancelling a subscription from the billing page.
//
// The Refund & Cancellation policy promises cancellation "from the billing area
// of your account", with the plan staying active until the end of the paid
// period. Stripe customers get that through Stripe's portal. Razorpay customers
// had no way at all — nothing in the app called Razorpay's cancel API — so this
// is that path: cancel at the end of the current cycle, record when access
// ends, and leave the actual switch-off to the subscription.cancelled webhook
// Razorpay sends when the cycle is over.
//
// Where it's recorded: tenants.subscription_cancel_at (migration
// 20261101200000). Until that migration is applied the column doesn't exist,
// so every write tolerates its absence and reads fall back to the
// wa_owner_audit row the cancel also writes.

import { db } from "./supabase";
import { ownerAudit, type Tenant } from "./tenants";
import { cancelRazorpaySubscriptionAtCycleEnd } from "./razorpay";
import { errorMessage } from "./errors";

export const CANCEL_AUDIT_ACTION = "billing.cancel_scheduled";

export type BillingProvider = "razorpay" | "stripe";

// Which provider is billing this workspace right now. payment_provider is only
// ever written by the Razorpay paths (Stripe's webhook predates the column), so
// "razorpay" is trusted from it and anything with a Stripe subscription is
// Stripe. A razorpay_subscription_id ALONE proves nothing: checkout stamps it
// the moment the modal opens, before anyone has paid.
export function billingProvider(t: Tenant): BillingProvider | null {
  if (t.paymentProvider === "razorpay" && t.razorpaySubscriptionId) return "razorpay";
  if (t.stripeSubscriptionId || (t.paymentProvider === "stripe" && t.stripeCustomerId)) return "stripe";
  return null;
}

/** A paid subscription that is still taking (or retrying) renewals. */
export function hasLiveSubscription(t: Tenant): boolean {
  return billingProvider(t) !== null && (t.paymentStatus === "active" || t.paymentStatus === "past_due");
}

// Postgres "column does not exist" / PostgREST "column not in schema cache" —
// i.e. the migration hasn't been applied yet.
function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return !!e && (e.code === "42703" || e.code === "PGRST204" || /subscription_cancel_at/.test(e.message ?? ""));
}

/** Store (or clear, with null) when this workspace's subscription stops renewing. */
export async function recordCancelAt(tenantId: string, cancelAt: string | null): Promise<void> {
  const { error } = await db().from("tenants").update({ subscription_cancel_at: cancelAt }).eq("id", tenantId);
  if (error && !isMissingColumn(error)) {
    console.error(JSON.stringify({ at: "billing-cancel.recordCancelAt", tenantId, error: errorMessage(error) }));
  }
}

// The audit row doubles as the record before the migration lands. Its detail
// names the subscription, so a cancel recorded against an old subscription is
// never mistaken for one on a newer subscription.
function auditDetail(subscriptionId: string, endsAt: string): string {
  return `${subscriptionId} until ${endsAt} — plan stays active until then and won't renew`;
}

/** When the current subscription stops renewing, or null if it renews as normal. */
export async function readCancelAt(t: Tenant): Promise<string | null> {
  const { data, error } = await db().from("tenants").select("subscription_cancel_at").eq("id", t.id).maybeSingle();
  if (!error) return ((data as { subscription_cancel_at?: string | null } | null)?.subscription_cancel_at) ?? null;
  if (!isMissingColumn(error) || !t.razorpaySubscriptionId) return null;
  const { data: rows } = await db().from("wa_owner_audit").select("detail")
    .eq("tenant_id", t.id).eq("action", CANCEL_AUDIT_ACTION)
    .order("created_at", { ascending: false }).limit(5);
  for (const r of (rows ?? []) as { detail?: string }[]) {
    const m = /^(\S+) until (\S+)/.exec(r.detail ?? "");
    if (m && m[1] === t.razorpaySubscriptionId) return m[2];
  }
  return null;
}

export interface CancelOutcome { status: number; body: Record<string, unknown> }

/**
 * Cancel the workspace's Razorpay subscription at the end of the paid period.
 * Idempotent: a second call (double click, retry, a second admin) returns the
 * same end date without calling Razorpay again. Access is NOT changed here —
 * the plan stays exactly as it is until Razorpay reports the cycle has ended.
 */
export async function cancelRazorpayAtPeriodEnd(t: Tenant, actorEmail: string): Promise<CancelOutcome> {
  const provider = billingProvider(t);
  if (provider === "stripe") {
    return { status: 400, body: { error: "This subscription is billed through Stripe — cancel it from Manage billing.", provider: "stripe" } };
  }
  if (provider !== "razorpay" || !t.razorpaySubscriptionId) {
    return { status: 400, body: { error: "There's no active subscription to cancel on this workspace." } };
  }
  if (t.paymentStatus === "cancelled") {
    return { status: 200, body: { ok: true, alreadyCancelled: true, endsAt: t.currentPeriodEnd } };
  }
  if (!hasLiveSubscription(t)) {
    return { status: 400, body: { error: "There's no active subscription to cancel on this workspace." } };
  }

  const existing = await readCancelAt(t);
  if (existing) return { status: 200, body: { ok: true, alreadyScheduled: true, endsAt: existing } };

  const subId = t.razorpaySubscriptionId;
  let res;
  try {
    res = await cancelRazorpaySubscriptionAtCycleEnd(subId);
  } catch (err) {
    console.error(JSON.stringify({ at: "billing-cancel.razorpay", tenantId: t.id, subId, error: errorMessage(err) }));
    return { status: 502, body: { error: `Razorpay couldn't cancel the subscription: ${errorMessage(err)}. Nothing has changed — please try again, or contact support.` } };
  }

  // The paid period's end. ended_at only exists once the subscription has
  // actually finished (e.g. it was already cancelled outright), and then that
  // IS when access ended.
  const endsAt = res.endedAt ?? res.currentEnd ?? t.currentPeriodEnd;
  if (endsAt) await recordCancelAt(t.id, endsAt);
  await ownerAudit(actorEmail, CANCEL_AUDIT_ACTION, t.id, endsAt ? auditDetail(subId, endsAt) : `${subId} — won't renew (period end not reported)`);
  return { status: 200, body: { ok: true, endsAt, ...(res.alreadyCancelled ? { alreadyCancelled: true } : {}) } };
}
