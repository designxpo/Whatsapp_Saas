// GST + payment-gateway-fee-estimate math for subscription checkout. Pure
// functions, no I/O — the single source of truth so the checkout route and
// any future invoice code compute the exact same numbers.
//
// Prices in wa_plans are GST-EXCLUSIVE: the advertised price (e.g. ₹1,999) is
// the base, and GST + an estimated gateway fee are added ON TOP at checkout,
// raising the real amount charged.
//
// GATEWAY_FEE_ESTIMATE_RATE is Razorpay's published standard domestic rate
// (2% + 18% GST on that fee = 2.36% effective — see
// https://www.softwaresuggest.com/blog/razorpay-payment-gateway-charges/).
// It's an ESTIMATE baked into checkout upfront: Razorpay only reports the
// real per-payment fee (which varies by method — UPI is often fee-free,
// domestic cards ~2%, international/corporate cards higher) after the charge
// completes, so no exact pre-charge gross-up is possible. The real fee is
// recorded separately once known (see wa_billing_events, migration 0109).

export const GST_RATE = 0.18;
export const GATEWAY_FEE_ESTIMATE_RATE = 0.0236;

export interface PriceBreakdown {
  baseAmountCents: number;
  taxCents: number;
  gatewayFeeEstimateCents: number;
  totalChargedCents: number;
}

export function computeChargeBreakdown(baseAmountCents: number): PriceBreakdown {
  const taxCents = Math.round(baseAmountCents * GST_RATE);
  const subtotal = baseAmountCents + taxCents;
  const gatewayFeeEstimateCents = Math.round(subtotal * GATEWAY_FEE_ESTIMATE_RATE);
  return { baseAmountCents, taxCents, gatewayFeeEstimateCents, totalChargedCents: subtotal + gatewayFeeEstimateCents };
}
