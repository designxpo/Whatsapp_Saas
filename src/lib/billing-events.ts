// wa_billing_events — one row per charge (every renewal, not just the first
// payment). Durable, itemized record of what was charged (base + GST + the
// checkout-time gateway-fee ESTIMATE) and, once known, the REAL post-charge
// gateway fee Razorpay reports — the basis for accurate net-revenue reporting
// (see migration 0109_billing_gst_fees.sql, src/lib/billing-tax.ts).

import { db } from "./supabase";
import type { PaymentProvider } from "./tenants";
import type { PriceBreakdown } from "./billing-tax";

export async function recordBillingEvent(tenantId: string, p: {
  provider: PaymentProvider; providerPaymentId?: string | null; currency: string;
  breakdown: PriceBreakdown;
}): Promise<void> {
  const { error } = await db().from("wa_billing_events").insert({
    tenant_id: tenantId, provider: p.provider, provider_payment_id: p.providerPaymentId ?? null,
    base_amount_cents: p.breakdown.baseAmountCents, tax_cents: p.breakdown.taxCents,
    gateway_fee_estimate_cents: p.breakdown.gatewayFeeEstimateCents,
    total_charged_cents: p.breakdown.totalChargedCents, currency: p.currency,
  });
  if (error) throw error;
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
