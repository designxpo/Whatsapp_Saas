// Subscription checkout price math. Pure functions, no I/O — the single source
// of truth, so the checkout route, the marketing pricing table and the billing
// document all quote the same number.
//
// NO GST IS CHARGED. PM Technologies holds MSME (Udyam) registration only and
// has no GSTIN, and s.32(1) of the CGST Act 2017 is absolute: "A person who is
// not a registered person shall not collect in respect of any supply of goods or
// services or both any amount by way of tax under this Act." Udyam is a
// classification, not a tax registration — MSME's own S.O. 1055(E) (5 Mar 2021)
// defers the GSTIN question back to the CGST Act. So the LABEL is the offence,
// not the amount: charging a higher all-inclusive price is perfectly lawful,
// presenting any slice of it as "GST" is not. Do not reintroduce a tax line here
// or in any UI until a real GSTIN exists (see supplier-identity.ts, which gates
// the invoice label on exactly that).
//
// Registration becomes mandatory once all-India aggregate turnover crosses
// ₹20 lakh (s.22(1); the ₹40 lakh figure is goods-only, per its third proviso).
// When that happens, switch checkout to computeCompliantChargeBreakdown() below
// — it is written and tested, and the whole invoice engine flips on with it.
//
// GATEWAY_FEE_ESTIMATE_RATE is Razorpay's published standard domestic rate
// (2% + 18% GST on Razorpay's own fee = 2.36% effective). It's an ESTIMATE baked
// into the price upfront: Razorpay only reports the real per-payment fee (which
// varies by method — UPI is often fee-free, domestic cards ~2%, international
// higher) after the charge completes, so no exact pre-charge figure is possible.
// The real fee is recorded once known (see wa_billing_events, migration 0109).

export const GST_RATE = 0.18;
export const GATEWAY_FEE_ESTIMATE_RATE = 0.0236;

export interface PriceBreakdown {
  baseAmountCents: number;
  taxCents: number;
  gatewayFeeEstimateCents: number;
  totalChargedCents: number;
}

/**
 * The single all-inclusive amount a customer is charged, grossed up from the
 * plan's base price so Razorpay's cut comes out of the fee rather than out of
 * the base.
 *
 * Solving `total - base = rate * total` (Razorpay bills its percentage on the
 * FULL captured amount, not on our base) gives `total = base / (1 - rate)`.
 * Naively that lands on ₹1,023.15 — so the result is rounded to whole RUPEES,
 * which keeps every advertised and charged figure a clean number and leaves the
 * recovery within a few paise either way.
 *
 * `taxCents` is deliberately 0 rather than removed: it keeps this shape
 * compatible with wa_billing_events, applySubscription and the invoice renderer
 * (whose tax rows correctly disappear at zero), so registering for GST later is
 * a swap of this one function and not a schema migration.
 */
export function computeChargeBreakdown(baseAmountCents: number): PriceBreakdown {
  if (baseAmountCents <= 0) return { baseAmountCents, taxCents: 0, gatewayFeeEstimateCents: 0, totalChargedCents: 0 };
  const exact = baseAmountCents / (1 - GATEWAY_FEE_ESTIMATE_RATE);
  const totalChargedCents = Math.round(exact / 100) * 100;   // whole rupees
  return {
    baseAmountCents,
    taxCents: 0,
    gatewayFeeEstimateCents: totalChargedCents - baseAmountCents,
    totalChargedCents,
  };
}

/**
 * The same all-inclusive price, for surfaces that work in whole rupees rather
 * than paise (the marketing pricing table). Routed through
 * computeChargeBreakdown so the advertised number can never drift from the
 * number actually charged — which is the whole point of quoting one figure.
 *
 * Always returns a whole rupee, because computeChargeBreakdown rounds there.
 */
export function allInclusiveRupees(baseRupees: number): number {
  return computeChargeBreakdown(Math.round(baseRupees * 100)).totalChargedCents / 100;
}

// --- Place of supply -------------------------------------------------------
//
// A tax invoice may not show a lump "GST" line: it must show CGST+SGST for an
// intra-state supply and IGST for an inter-state one, decided by place of
// supply (IGST Act s.12). Which one applies is a property of the two parties,
// not of the amount, so the split lives apart from the amount math above.

export type TaxKind = "cgst_sgst" | "igst" | "none";

export interface TaxSplit {
  kind: TaxKind;
  cgstCents: number;
  sgstCents: number;
  igstCents: number;
  totalTaxCents: number;
}

export function splitTax(
  taxCents: number,
  supplierStateCode: string | null,
  recipientStateCode: string | null,
): TaxSplit {
  if (!supplierStateCode || !recipientStateCode) {
    // Place of supply is undeterminable without both state codes, so we cannot
    // assert either split on a document — we only carry the total forward and
    // leave the caller to collect the missing GSTIN/state before invoicing.
    return { kind: "none", cgstCents: 0, sgstCents: 0, igstCents: 0, totalTaxCents: taxCents };
  }

  if (supplierStateCode === recipientStateCode) {
    // Halving must neither lose nor invent a paisa: floor one half and give the
    // remainder to the other, so an odd total still reconciles exactly.
    const cgstCents = Math.floor(taxCents / 2);
    const sgstCents = taxCents - cgstCents;
    return { kind: "cgst_sgst", cgstCents, sgstCents, igstCents: 0, totalTaxCents: taxCents };
  }

  return { kind: "igst", cgstCents: 0, sgstCents: 0, igstCents: taxCents, totalTaxCents: taxCents };
}

// --- Section 15 compliant gross-up ----------------------------------------
//
// computeChargeBreakdown() taxes the base only and then bolts the gateway fee
// on top UNTAXED. But the fee is recovered FROM the customer, so under s.15 of
// the CGST Act it is part of the value of supply and is itself taxable —
// meaning that breakdown under-declares GST by 18% of the fee.
//
// The compliant version instead solves for the fee, so the fee we collect
// really covers what Razorpay deducts from the gross (Razorpay charges its
// percentage on the full amount captured, GST included, not on our base):
//   taxableValue = base / (1 - GATEWAY_FEE_ESTIMATE_RATE * (1 + GST_RATE))
//
// NOT WIRED IN ANYWHERE YET, deliberately. Switching checkout over changes
// what real customers are charged and Razorpay plan amounts are immutable, so
// adopting it means minting new plan ids and migrating live subscriptions.

export interface CompliantPriceBreakdown {
  baseAmountCents: number;
  gatewayFeeEstimateCents: number;
  taxableValueCents: number;
  taxCents: number;
  totalChargedCents: number;
}

export function computeCompliantChargeBreakdown(baseAmountCents: number): CompliantPriceBreakdown {
  // Round the taxable value to whole paise FIRST, then derive the fee from it,
  // so base + fee === taxableValue exactly and every field stays an integer.
  const taxableValueCents = Math.round(baseAmountCents / (1 - GATEWAY_FEE_ESTIMATE_RATE * (1 + GST_RATE)));
  const gatewayFeeEstimateCents = taxableValueCents - baseAmountCents;
  const taxCents = Math.round(taxableValueCents * GST_RATE);
  return {
    baseAmountCents,
    gatewayFeeEstimateCents,
    taxableValueCents,
    taxCents,
    totalChargedCents: taxableValueCents + taxCents,
  };
}
