import { describe, it, expect } from "vitest";
import {
  computeChargeBreakdown,
  computeCompliantChargeBreakdown,
  splitTax,
  GST_RATE,
  GATEWAY_FEE_ESTIMATE_RATE,
} from "../billing-tax";

describe("computeChargeBreakdown — all-inclusive price, NO GST", () => {
  // The live plan table: base price → the whole-rupee all-inclusive amount.
  const CASES: [string, number, number][] = [
    ["Creator ₹999", 99_900, 102_300],       // ₹1,023
    ["Starter ₹1,999", 199_900, 204_700],    // ₹2,047
    ["Creator Pro ₹2,999", 299_900, 307_100],// ₹3,071
    ["Growth ₹5,999", 599_900, 614_400],     // ₹6,144
    ["Scale ₹9,999", 999_900, 1_024_100],    // ₹10,241
  ];

  it.each(CASES)("%s grosses up to the expected all-inclusive amount", (_label, base, expected) => {
    expect(computeChargeBreakdown(base).totalChargedCents).toBe(expected);
  });

  it("charges NO tax — the company has no GSTIN, so a tax line would breach s.32(1) CGST Act", () => {
    // The single most important assertion in this file. If someone reintroduces
    // GST into the charged amount without a GSTIN being in place, this fails.
    for (const [, base] of CASES) {
      expect(computeChargeBreakdown(base).taxCents).toBe(0);
    }
  });

  it("₹0 base produces ₹0 everything", () => {
    expect(computeChargeBreakdown(0)).toEqual({ baseAmountCents: 0, taxCents: 0, gatewayFeeEstimateCents: 0, totalChargedCents: 0 });
  });

  it("every field sums to the total — no rounding drift", () => {
    for (const base of [1, 999_00, 1_999_00, 2_999_00, 5_999_00, 12_345]) {
      const b = computeChargeBreakdown(base);
      expect(b.baseAmountCents + b.taxCents + b.gatewayFeeEstimateCents).toBe(b.totalChargedCents);
    }
  });

  it("always lands on a whole rupee, so no advertised price shows stray paise", () => {
    for (const base of [99_900, 199_900, 299_900, 599_900, 999_900, 12_345, 1]) {
      expect(computeChargeBreakdown(base).totalChargedCents % 100).toBe(0);
    }
  });

  it("recovers what Razorpay actually deducts, to within the whole-rupee rounding", () => {
    // Razorpay bills its percentage on the FULL captured amount, so the fee we
    // add must be checked against a cut of the total, not of the base. Rounding
    // to whole rupees can leave us up to ~₹0.50 either side; anything worse
    // means the gross-up formula is wrong.
    for (const [, base] of CASES) {
      const b = computeChargeBreakdown(base);
      const razorpayTakes = b.totalChargedCents * GATEWAY_FEE_ESTIMATE_RATE;
      expect(Math.abs(razorpayTakes - b.gatewayFeeEstimateCents)).toBeLessThanOrEqual(50);
    }
  });

  it("keeps GST_RATE exported for the day registration happens", () => {
    // Dormant, not dead: computeCompliantChargeBreakdown and the invoice
    // renderer both need it the moment a GSTIN exists.
    expect(GST_RATE).toBe(0.18);
  });
});

describe("splitTax — place of supply", () => {
  it("splits intra-state tax into equal CGST + SGST halves", () => {
    const s = splitTax(36_000, "27", "27");
    expect(s.kind).toBe("cgst_sgst");
    expect(s.cgstCents).toBe(18_000);
    expect(s.sgstCents).toBe(18_000);
    expect(s.igstCents).toBe(0);
    expect(s.totalTaxCents).toBe(36_000);
  });

  it("loses no paisa halving an odd intra-state tax", () => {
    // 37013 cannot halve evenly, so one side must carry the stray paisa rather
    // than both sides rounding up (inventing one) or down (losing one).
    const s = splitTax(37_013, "07", "07");
    expect(s.cgstCents).toBe(18_506);
    expect(s.sgstCents).toBe(18_507);
    expect(s.cgstCents + s.sgstCents).toBe(37_013);
    for (const tax of [1, 3, 999, 37_013, 100_001]) {
      const odd = splitTax(tax, "29", "29");
      expect(odd.cgstCents + odd.sgstCents).toBe(tax);
      expect(odd.totalTaxCents).toBe(tax);
    }
  });

  it("charges the whole amount as IGST across state lines", () => {
    const s = splitTax(37_013, "27", "07");
    expect(s.kind).toBe("igst");
    expect(s.igstCents).toBe(37_013);
    expect(s.cgstCents).toBe(0);
    expect(s.sgstCents).toBe(0);
    expect(s.totalTaxCents).toBe(37_013);
  });

  it("asserts no split when either state is unknown, but still carries the total", () => {
    for (const [supplier, recipient] of [
      [null, "27"],
      ["27", null],
      [null, null],
    ] as const) {
      const s = splitTax(37_013, supplier, recipient);
      expect(s.kind).toBe("none");
      expect(s.cgstCents).toBe(0);
      expect(s.sgstCents).toBe(0);
      expect(s.igstCents).toBe(0);
      expect(s.totalTaxCents).toBe(37_013);
    }
  });
});

describe("computeCompliantChargeBreakdown — s.15 gross-up", () => {
  it("matches the Creator-plan worked example (₹1,999 base)", () => {
    const b = computeCompliantChargeBreakdown(199_900);
    expect(b.baseAmountCents).toBe(199_900);
    expect(Math.abs(b.taxableValueCents - 205_626)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.taxCents - 37_013)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.totalChargedCents - 242_639)).toBeLessThanOrEqual(1);
  });

  it("collects a fee that actually covers what Razorpay takes off the gross", () => {
    // The property that matters: Razorpay's cut is a percentage of the FULL
    // captured amount, so the fee we grossed up must match a cut of the total.
    for (const base of [199_900, 99_900, 299_900, 599_900, 1, 12_345]) {
      const b = computeCompliantChargeBreakdown(base);
      const razorpayTakes = Math.round(b.totalChargedCents * GATEWAY_FEE_ESTIMATE_RATE);
      expect(Math.abs(razorpayTakes - b.gatewayFeeEstimateCents)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps base + fee === taxable value, and taxes the fee too", () => {
    for (const base of [199_900, 99_900, 1, 12_345]) {
      const b = computeCompliantChargeBreakdown(base);
      expect(b.baseAmountCents + b.gatewayFeeEstimateCents).toBe(b.taxableValueCents);
      expect(b.taxableValueCents + b.taxCents).toBe(b.totalChargedCents);
      expect(b.taxCents).toBe(Math.round(b.taxableValueCents * GST_RATE));
      // Every field is whole paise — nothing downstream may see a fraction.
      for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("declares more GST than the legacy breakdown, because it taxes the fee", () => {
    const legacy = computeChargeBreakdown(199_900);
    const compliant = computeCompliantChargeBreakdown(199_900);
    expect(compliant.taxCents).toBeGreaterThan(legacy.taxCents);
  });

  it("₹0 base produces ₹0 everything", () => {
    expect(computeCompliantChargeBreakdown(0)).toEqual({
      baseAmountCents: 0,
      gatewayFeeEstimateCents: 0,
      taxableValueCents: 0,
      taxCents: 0,
      totalChargedCents: 0,
    });
  });
});
