// Rendering + send-once behaviour for the invoice/receipt email. No database:
// issueInvoiceForBillingEvent is stubbed so every case can pin an exact
// InvoiceData, which is the only way to assert what a statutory document
// actually prints.
//
// The supabase stub is the interesting part. sendInvoiceEmail's idempotency is
// an atomic `update … where invoice_emailed_at is null` (see invoice-email.ts),
// so the stub has to model that compare-and-set rather than a boolean flag —
// mock it as "always succeeds" and the redelivery test passes while proving
// nothing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InvoiceData } from "../invoice";

const sent: { to: string; subject: string; html: string; text: string }[] = [];
/** id → the timestamp stamped on that row, mirroring wa_billing_events. */
const emailedAt = new Map<string, string>();

vi.mock("../email", () => ({
  sendEmail: async (o: { to: string; subject: string; html: string; text: string }) => {
    sent.push(o);
    return { ok: true };
  },
}));

// Minimal chainable stand-in for the PostgREST builder, covering exactly the two
// shapes invoice-email.ts uses: the claim (update → eq → is → select) and the
// release (update → eq, awaited with no select).
vi.mock("../supabase", () => {
  const db = () => {
    const st: { patch: Record<string, unknown>; id: string; requireNull: boolean } =
      { patch: {}, id: "", requireNull: false };
    const run = () => {
      const stamp = st.patch.invoice_emailed_at;
      if (stamp === null) { emailedAt.delete(st.id); return { data: null, error: null }; }
      // The `where invoice_emailed_at is null` predicate: a row already stamped
      // matches nothing, so the caller sees an empty result and stops.
      if (st.requireNull && emailedAt.has(st.id)) return { data: [], error: null };
      emailedAt.set(st.id, String(stamp));
      return { data: [{ id: st.id }], error: null };
    };
    const chain = {
      from: () => chain,
      update: (p: Record<string, unknown>) => { st.patch = p; return chain; },
      eq: (col: string, v: string) => { if (col === "id") st.id = v; return chain; },
      is: (col: string, v: unknown) => { if (col === "invoice_emailed_at" && v === null) st.requireNull = true; return chain; },
      select: () => chain,
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };
  return { db };
});

let current: InvoiceData | null = null;

vi.mock("../invoice", async (importOriginal) => {
  const real = await importOriginal<typeof import("../invoice")>();
  return { ...real, issueInvoiceForBillingEvent: async () => current };
});

const { sendInvoiceEmail } = await import("../invoice-email");

// Legacy gross-up numbers for a ₹1,999 base: tax = 18% of the base only, fee on
// the (base+tax) subtotal, taxable value = base + fee. This is what checkout
// charges today, hence the default here.
function legacy(over: Partial<InvoiceData> = {}): InvoiceData {
  return {
    documentLabel: "Tax Invoice",
    invoiceNumber: "TALKO/2026-27/00001",
    issuedAt: "2026-08-22T09:00:00Z",
    supplier: {
      legalName: "PM TECHNOLOGIES", tradeName: "Talko AI", gstin: "07AABCU9603R1ZM",
      addressLines: ["12 Example Road", "New Delhi 110001"], stateName: "Delhi",
      stateCode: "07", sacCode: "998314", signatory: "A Person", cin: null, pan: null,
    },
    recipient: {
      legalName: "Acme Retail LLP", address: "5 Market St\nMumbai 400001",
      state: "Maharashtra", stateCode: "27", gstin: "27AABCU9603R1ZX", email: "owner@acme.test",
    },
    planName: "Growth", sacCode: "998314", currency: "INR",
    baseAmountCents: 199900, gatewayFeeEstimateCents: 5567, taxableValueCents: 205467,
    taxSplit: { kind: "igst", cgstCents: 0, sgstCents: 0, igstCents: 35982, totalTaxCents: 35982 },
    totalChargedCents: 241449,
    paymentMethod: "upi", providerPaymentId: "pay_ABC123",
    periodStart: "2026-08-22T09:00:00Z", periodEnd: "2026-09-22T09:00:00Z",
    placeOfSupply: "Maharashtra (27)", isTaxInvoice: true,
    ...over,
  };
}

beforeEach(() => { sent.length = 0; emailedAt.clear(); });

describe("sendInvoiceEmail", () => {
  it("sends once and drops the redelivery", async () => {
    current = legacy();
    expect(await sendInvoiceEmail("ev-1")).toBe(true);
    expect(await sendInvoiceEmail("ev-1")).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("drops a redelivery even long after the 48h webhook-dedup window", async () => {
    // The whole reason the claim is a row update and not claimWebhookEvent:
    // pruneEphemeral() would have dropped the dedup row by now, so a backfill or
    // support replay must still be refused by the durable stamp.
    current = legacy();
    expect(await sendInvoiceEmail("ev-late")).toBe(true);
    expect(emailedAt.has("ev-late")).toBe(true);
    expect(await sendInvoiceEmail("ev-late")).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("bails on a null invoice and on a missing email without consuming the claim", async () => {
    current = null;
    expect(await sendInvoiceEmail("ev-2")).toBe(false);
    current = legacy({ recipient: { ...legacy().recipient, email: null } });
    expect(await sendInvoiceEmail("ev-2")).toBe(false);
    expect(emailedAt.size).toBe(0);
    // A retry once the email exists still gets through.
    current = legacy();
    expect(await sendInvoiceEmail("ev-2")).toBe(true);
  });

  it("carries label + number in the subject", async () => {
    current = legacy();
    await sendInvoiceEmail("ev-3");
    expect(sent[0].subject).toBe("Talko AI Tax Invoice TALKO/2026-27/00001");
  });

  it("reconciles the printed column and omits an unstateable rate", async () => {
    current = legacy();
    await sendInvoiceEmail("ev-4");
    const t = sent[0].text;
    expect(t).toContain("₹1,999.00");
    expect(t).toContain("₹55.67");
    expect(t).toContain("₹2,054.67");
    expect(t).toContain("₹359.82");
    expect(t).toContain("₹2,414.49");
    // 359.82 is 18% of the base, not of 2054.67 — so no rate may be claimed.
    expect(t).not.toContain("IGST @");
    expect(t).toContain("IGST");
    expect(2054_67 + 359_82).toBe(2414_49);
  });

  it("prints the statutory rate under the compliant breakdown, split intra-state", async () => {
    const { computeCompliantChargeBreakdown } = await import("../billing-tax");
    const b = computeCompliantChargeBreakdown(199900);
    const cgst = Math.floor(b.taxCents / 2);
    current = legacy({
      baseAmountCents: b.baseAmountCents, gatewayFeeEstimateCents: b.gatewayFeeEstimateCents,
      taxableValueCents: b.taxableValueCents, totalChargedCents: b.totalChargedCents,
      taxSplit: { kind: "cgst_sgst", cgstCents: cgst, sgstCents: b.taxCents - cgst, igstCents: 0, totalTaxCents: b.taxCents },
      recipient: { ...legacy().recipient, stateCode: "07", gstin: null },
      placeOfSupply: "Delhi (07)",
    });
    await sendInvoiceEmail("ev-5");
    const t = sent[0].text;
    expect(t).toContain("CGST @ 9%");
    expect(t).toContain("SGST @ 9%");
    expect(t).toContain("Customer GSTIN: Unregistered");
    expect(t).toContain("Tax is not payable on reverse charge basis");
  });

  it("labels a receipt honestly and drops every GST particular", async () => {
    current = legacy({
      documentLabel: "Payment Receipt", isTaxInvoice: false,
      supplier: { ...legacy().supplier, gstin: null, sacCode: null, signatory: null, addressLines: [] },
      sacCode: null, placeOfSupply: null,
      taxSplit: { kind: "none", cgstCents: 0, sgstCents: 0, igstCents: 0, totalTaxCents: 35982 },
    });
    await sendInvoiceEmail("ev-6");
    const t = sent[0].text;
    expect(t).toContain("not a valid tax invoice");
    expect(t).not.toContain("GSTIN");
    expect(t).not.toContain("SAC");
    expect(t).not.toContain("Place of supply");
    expect(t).toContain("GST ");
    // "CGST" only ever appears in the disclaimer's citation of the Act.
    expect(t.replace("CGST Act", "")).not.toContain("CGST");
  });

  it("skips the subtotal row when there is no gateway fee", async () => {
    current = legacy({ gatewayFeeEstimateCents: 0, taxableValueCents: 199900, totalChargedCents: 235882 });
    await sendInvoiceEmail("ev-7");
    expect(sent[0].text).not.toContain("Taxable value");
    expect(sent[0].text).not.toContain("Payment gateway fee");
  });

  it("escapes a hostile recipient name rather than emitting markup", async () => {
    current = legacy({ recipient: { ...legacy().recipient, legalName: "<script>x</script> & Co" } });
    await sendInvoiceEmail("ev-8");
    expect(sent[0].html).not.toContain("<script>");
    expect(sent[0].html).toContain("&lt;script&gt;");
  });
});
