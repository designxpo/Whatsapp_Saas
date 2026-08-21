import { describe, it, expect } from "vitest";
import { computeChargeBreakdown, GST_RATE, GATEWAY_FEE_ESTIMATE_RATE } from "../billing-tax";

describe("computeChargeBreakdown — GST + gateway-fee-estimate gross-up", () => {
  it("matches the Creator-plan worked example (₹1,999 base)", () => {
    // base 199900 → +18% GST = 235882 → +2.36% gateway estimate ≈ 5567 → total ≈ 241449
    const b = computeChargeBreakdown(199_900);
    expect(b.baseAmountCents).toBe(199_900);
    expect(b.taxCents).toBe(35_982);
    expect(b.gatewayFeeEstimateCents).toBe(5_567);
    expect(b.totalChargedCents).toBe(241_449);
  });

  it("₹0 base produces ₹0 everything", () => {
    const b = computeChargeBreakdown(0);
    expect(b).toEqual({ baseAmountCents: 0, taxCents: 0, gatewayFeeEstimateCents: 0, totalChargedCents: 0 });
  });

  it("every field sums to the total — no rounding drift between the breakdown and its total", () => {
    // An odd cents value exercises the rounding at both the GST and fee steps.
    for (const base of [1, 999_00, 1_999_00, 2_999_00, 5_999_00, 12_345]) {
      const b = computeChargeBreakdown(base);
      expect(b.baseAmountCents + b.taxCents + b.gatewayFeeEstimateCents).toBe(b.totalChargedCents);
    }
  });

  it("GST is computed on the base, and the gateway fee estimate is computed on base+GST (not on base alone)", () => {
    const base = 100_000;
    const b = computeChargeBreakdown(base);
    const expectedTax = Math.round(base * GST_RATE);
    const expectedFee = Math.round((base + expectedTax) * GATEWAY_FEE_ESTIMATE_RATE);
    expect(b.taxCents).toBe(expectedTax);
    expect(b.gatewayFeeEstimateCents).toBe(expectedFee);
  });
});
