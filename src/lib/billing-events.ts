// wa_billing_events — one row per charge (every renewal, not just the first
// payment). Durable, itemized record of what was charged (base + GST + the
// checkout-time gateway-fee ESTIMATE) and, once known, the REAL post-charge
// gateway fee Razorpay reports — the basis for accurate net-revenue reporting
// (see migration 0109_billing_gst_fees.sql, src/lib/billing-tax.ts).

import { db } from "./supabase";
import type { PaymentProvider } from "./tenants";
import type { PriceBreakdown } from "./billing-tax";

// Records one charge and returns the new row's id, so a caller can act on THIS
// charge specifically — issuing and emailing its invoice has to name a single
// billing event, and provider_payment_id is not a usable handle for that (it is
// null on any charge that arrives without one, and it addresses a payment
// rather than the row).
//
// Still best-effort at the CALL SITE, which is where it matters: every caller
// wraps this in .catch() and carries on, because a charge the gateway already
// took must never be undone — or retried — by a bookkeeping failure. The throw
// is kept deliberately, since swallowing the error here would also swallow the
// message the caller logs. Null only if the insert somehow returned no row.
export async function recordBillingEvent(tenantId: string, p: {
  provider: PaymentProvider; providerPaymentId?: string | null; currency: string;
  breakdown: PriceBreakdown; paymentMethod?: string | null;
}): Promise<string | null> {
  const { data, error } = await db().from("wa_billing_events").insert({
    tenant_id: tenantId, provider: p.provider, provider_payment_id: p.providerPaymentId ?? null,
    base_amount_cents: p.breakdown.baseAmountCents, tax_cents: p.breakdown.taxCents,
    gateway_fee_estimate_cents: p.breakdown.gatewayFeeEstimateCents,
    total_charged_cents: p.breakdown.totalChargedCents, currency: p.currency,
    // How the customer actually paid (card/upi/netbanking…), as the gateway
    // reports it — a Rule 46 document names the payment instrument, and it can
    // only be captured here, at the moment the charge is recorded.
    payment_method: p.paymentMethod ?? null,
  }).select("id").single();

  // 23505 = the unique index on provider_payment_id (migration 0110) rejecting
  // a second row for a payment we already recorded. That is the EXPECTED path,
  // not an error: a first payment is reported twice, once by the checkout
  // confirmation and once by the subscription.charged webhook, and the two race
  // by design. Returning the existing row's id makes both callers converge on
  // one billing event — which is what keeps the charge counted once in revenue
  // and issued exactly one invoice number.
  if (error) {
    if ((error as { code?: string }).code === "23505" && p.providerPaymentId) {
      const { data: existing } = await db().from("wa_billing_events")
        .select("id").eq("provider_payment_id", p.providerPaymentId).maybeSingle();
      // payment_method arrives only on the webhook leg, so the row inserted by
      // the checkout confirmation has none. Backfill it rather than losing the
      // instrument the document has to name — but never overwrite a value that
      // is already there.
      if (existing?.id && p.paymentMethod) {
        await db().from("wa_billing_events")
          .update({ payment_method: p.paymentMethod })
          .eq("id", existing.id).is("payment_method", null);
      }
      return (existing?.id as string) ?? null;
    }
    throw error;
  }
  return (data?.id as string) ?? null;
}

// Called once the subscription.charged webhook reports Razorpay's REAL fee
// for a specific payment — replaces the checkout-time estimate with a
// measured value. Matches by provider_payment_id; if no matching row exists
// (e.g. this payment's checkout-time event was somehow missed), this is a
// no-op rather than inserting a partial row with no base/tax breakdown.
export async function recordActualGatewayFee(providerPaymentId: string, feeCents: number, taxCents: number): Promise<void> {
  await db().from("wa_billing_events")
    .update({ gateway_fee_actual_cents: feeCents, gateway_tax_actual_cents: taxCents })
    .eq("provider_payment_id", providerPaymentId);
}
