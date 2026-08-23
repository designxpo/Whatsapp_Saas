// Billing documents for subscription charges: allocating the invoice number
// (CGST Rule 46(b) — consecutive, unique, and reset every Indian financial
// year) and assembling everything a rendered document needs. Rendering
// (HTML/PDF/email) lives elsewhere; this module only produces data.
//
// Everything statutory is read from the wa_billing_events row for the charge,
// never recomputed. A document states what the gateway actually took, so if a
// plan's price has since changed — or the GST rate has, or the gross-up model
// has (see billing-tax.ts) — the already-issued document must not move with it.
// See migration 0110_gst_invoices.sql for the columns this reads and stamps.

import { db } from "./supabase";
import { splitTax, type TaxKind, type TaxSplit } from "./billing-tax";
import { getPlan } from "./plans";
import { getTenant, type Tenant } from "./tenants";
import { documentLabel, supplierIdentity, type SupplierIdentity } from "./supplier-identity";

// One series for now. Kept a constant (rather than inlined) because credit
// notes and a second legal entity both need their own series later, and every
// one of them has to be numbered independently of this one.
export const INVOICE_SERIES = "TALKO";

// IST is a fixed +05:30 with no DST, so a constant offset is exact — no Intl
// round-trip needed, and no dependency on the server's own zone.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The Indian financial year a moment falls in, as "2026-27" (1 April – 31 March).
 *
 * Computed in IST, NOT in the server's zone. Vercel runs in UTC, so a renewal
 * charged at 23:00 UTC on 31 March is already 1 April in India and belongs to
 * the NEXT year's series. Numbering it into the old year puts an invoice in a
 * closed period, which is a filing correction rather than a cosmetic one.
 */
export function financialYearOf(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  // April is month 3. January–March still belong to the year that opened last April.
  const startYear = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** "TALKO/2026-27/00001" — zero-padded so the series sorts lexically. */
export function formatInvoiceNumber(series: string, financialYear: string, n: number): string {
  return `${series}/${financialYear}/${String(n).padStart(5, "0")}`;
}

/**
 * Claim the next number in `series` for the financial year `now` falls in.
 *
 * Throws on any RPC failure and never invents a fallback id. A consecutive
 * series is the whole point of Rule 46(b): a document numbered outside the
 * counter is unexplainable to an auditor forever, whereas a failed issue is
 * just a retry.
 */
export async function allocateInvoiceNumber(now: Date, series: string = INVOICE_SERIES): Promise<string> {
  const fy = financialYearOf(now);
  const { data, error } = await db().rpc("alloc_invoice_number", { p_series: series, p_fy: fy });
  if (error) throw error;
  const n = Number(data);
  if (!Number.isInteger(n) || n < 1) throw new Error(`alloc_invoice_number(${series}, ${fy}) returned ${JSON.stringify(data)}`);
  return formatInvoiceNumber(series, fy, n);
}

/**
 * Money for a printed document: "₹1,99,900.00". Same symbol convention as the
 * dunning emails and the billing page, but with paise always shown and Indian
 * digit grouping — a statutory document may not silently drop the paise off a
 * tax line, and the halves of a CGST/SGST split routinely land on odd paise.
 */
export function invoiceMoney(cents: number, currency: string): string {
  const cur = (currency || "INR").toUpperCase();
  const amount = (cents / 100).toLocaleString(cur === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${cur === "INR" ? "₹" : `${cur} `}${amount}`;
}

export interface InvoiceRecipient {
  legalName: string;
  address: string | null;
  state: string | null;
  stateCode: string | null;
  gstin: string | null;
  email: string | null;
}

export interface InvoiceData {
  /** As it was ACTUALLY issued — a receipt stays a receipt forever. */
  documentLabel: "Tax Invoice" | "Payment Receipt";
  invoiceNumber: string;
  issuedAt: string;
  supplier: SupplierIdentity;
  recipient: InvoiceRecipient;
  planName: string;
  sacCode: string | null;
  currency: string;
  baseAmountCents: number;
  gatewayFeeEstimateCents: number;
  /** The s.15 value of supply — base + the gateway fee recovered from the customer. */
  taxableValueCents: number;
  taxSplit: TaxSplit;
  totalChargedCents: number;
  paymentMethod: string | null;
  providerPaymentId: string | null;
  periodStart: string;
  periodEnd: string;
  placeOfSupply: string | null;
  isTaxInvoice: boolean;
}

// The wa_billing_events columns this module reads (0109 money + 0110 statutory).
interface BillingEventRow {
  id: string;
  tenant_id: string;
  provider_payment_id: string | null;
  base_amount_cents: number;
  tax_cents: number;
  gateway_fee_estimate_cents: number;
  total_charged_cents: number;
  currency: string | null;
  created_at: string;
  invoice_number: string | null;
  invoice_issued_at: string | null;
  taxable_value_cents: number | null;
  cgst_cents: number | null;
  sgst_cents: number | null;
  igst_cents: number | null;
  place_of_supply: string | null;
  payment_method: string | null;
  document_label: string | null;
}

// Rule 46 wants the place of supply WITH the name of the State, and the 2-digit
// code is what actually decides the tax head — so print both when we have both.
function placeOfSupplyOf(t: Tenant): string | null {
  const code = t.billingStateCode?.trim() || null;
  const name = t.billingState?.trim() || null;
  if (code && name) return `${name} (${code})`;
  if (code || name) return code ?? name;
  // No state recorded at all: for a supply outside India the country IS the
  // place of supply; for a domestic customer we simply don't know it yet and
  // must not guess (splitTax() already declines to split without it).
  const country = t.billingCountry?.trim() || null;
  return country && country.toUpperCase() !== "IN" ? country : null;
}

// `||` not `??` throughout — a blank string from a half-filled billing form
// should fall through to the next-best name, the same way hasBillingIdentity()
// treats it.
function recipientOf(t: Tenant): InvoiceRecipient {
  return {
    legalName: t.billingLegalName || t.company || t.name,
    address: t.billingAddress || null,
    state: t.billingState || null,
    stateCode: t.billingStateCode || null,
    gstin: t.gstin || null,
    email: t.ownerEmail || null,
  };
}

// Rebuild the split from the three stored columns rather than re-running
// splitTax(): the document must render straight from the row, so a later change
// to the tenant's state can never restate the tax head on an issued invoice.
// All three zero means no split was assertable when it was issued (or the
// charge carried no tax at all), which is exactly splitTax()'s "none".
function storedTaxSplit(r: BillingEventRow): TaxSplit {
  const cgstCents = r.cgst_cents ?? 0, sgstCents = r.sgst_cents ?? 0, igstCents = r.igst_cents ?? 0;
  const split = cgstCents + sgstCents + igstCents;
  const kind: TaxKind = igstCents > 0 ? "igst" : split > 0 ? "cgst_sgst" : "none";
  return { kind, cgstCents, sgstCents, igstCents, totalTaxCents: split || r.tax_cents };
}

// Month arithmetic with day clamping, so a charge on 31 January bills a period
// ending 28/29 February instead of overflowing into March.
function addMonthsUTC(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const out = new Date(d);
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastOfMonth = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastOfMonth));
  return out;
}

// The period a charge bought, derived from the charge date and the plan's
// interval. Deliberately NOT tenants.current_period_end: that tracks the LIVE
// subscription and moves on every renewal, so reading it would silently
// re-date an invoice issued months ago.
function periodEndOf(startISO: string, interval: string): string {
  const start = new Date(startISO);
  const months = interval === "year" ? 12 : interval === "quarter" ? 3 : 1;
  return addMonthsUTC(start, months).toISOString();
}

// Assemble the document from the row's STORED invoice fields — the only path
// that ever produces InvoiceData, so an issued invoice and a re-fetched one are
// byte-identical.
function assemble(ev: BillingEventRow, tenant: Tenant, planName: string, planInterval: string): InvoiceData {
  const label: InvoiceData["documentLabel"] = ev.document_label === "Tax Invoice" ? "Tax Invoice" : "Payment Receipt";
  const periodStart = ev.created_at;
  const supplier = supplierIdentity();
  return {
    documentLabel: label,
    invoiceNumber: ev.invoice_number!,
    issuedAt: ev.invoice_issued_at ?? ev.created_at,
    supplier,
    recipient: recipientOf(tenant),
    planName,
    sacCode: supplier.sacCode,
    currency: ev.currency ?? "INR",
    baseAmountCents: ev.base_amount_cents,
    gatewayFeeEstimateCents: ev.gateway_fee_estimate_cents,
    taxableValueCents: ev.taxable_value_cents ?? ev.base_amount_cents + ev.gateway_fee_estimate_cents,
    taxSplit: storedTaxSplit(ev),
    totalChargedCents: ev.total_charged_cents,
    paymentMethod: ev.payment_method,
    providerPaymentId: ev.provider_payment_id,
    periodStart,
    periodEnd: periodEndOf(periodStart, planInterval),
    placeOfSupply: ev.place_of_supply,
    isTaxInvoice: label === "Tax Invoice",
  };
}

const EVENT_COLUMNS = "id, tenant_id, provider_payment_id, base_amount_cents, tax_cents, gateway_fee_estimate_cents, total_charged_cents, currency, created_at, invoice_number, invoice_issued_at, taxable_value_cents, cgst_cents, sgst_cents, igst_cents, place_of_supply, payment_method, document_label";

/**
 * Issue (or re-read) the document for one charge.
 *
 * IDEMPOTENT, and that is the single most important property in this file. A
 * charge has exactly one document for its whole life: webhook redeliveries, a
 * customer re-downloading last month's invoice and a support agent re-sending
 * it all land here, and a second number for the same charge would mean two
 * documents claiming the same money — unfixable once either has been sent, and
 * a break in the Rule 46(b) series. So a row that already carries an
 * invoice_number is rebuilt from its STORED values and no number is allocated.
 *
 * Returns null (never throws) when the charge or its tenant is gone, so a
 * caller rendering a document list isn't taken down by one orphaned row.
 */
export async function issueInvoiceForBillingEvent(billingEventId: string): Promise<InvoiceData | null> {
  const { data, error } = await db().from("wa_billing_events").select(EVENT_COLUMNS).eq("id", billingEventId).maybeSingle();
  if (error || !data) {
    console.error(JSON.stringify({ at: "issueInvoiceForBillingEvent.event", billingEventId, error: error?.message ?? "not found" }));
    return null;
  }
  const ev = data as unknown as BillingEventRow;

  const tenant = await getTenant(ev.tenant_id);
  if (!tenant) {
    console.error(JSON.stringify({ at: "issueInvoiceForBillingEvent.tenant", billingEventId, tenantId: ev.tenant_id, error: "tenant not found" }));
    return null;
  }
  // The plan is consulted for its display name and billing interval ONLY —
  // never for a price. The amounts on a document are the recorded ones below.
  const plan = await getPlan(tenant.plan);
  const planName = plan?.name ?? tenant.plan;
  const planInterval = plan?.interval ?? "month";

  if (ev.invoice_number) return assemble(ev, tenant, planName, planInterval);

  const supplier = supplierIdentity();
  const label = documentLabel();
  const issuedAt = new Date();
  // The taxable value is the s.15 value of supply: the base plus the gateway
  // fee we recover from the customer. It equals total_charged − tax under both
  // gross-up models, which is the invariant that matters on a document — the
  // stated total is the money that actually left the customer's account. (Under
  // the legacy breakdown the recorded tax is 18% of the base only, so the
  // effective rate on this taxable value reads slightly under 18%; that
  // under-declaration is a property of how the charge was priced, documented in
  // billing-tax.ts, and stating a larger tax than we collected would be worse.)
  const taxableValueCents = ev.base_amount_cents + ev.gateway_fee_estimate_cents;
  const taxSplit = splitTax(ev.tax_cents, supplier.stateCode, tenant.billingStateCode);
  const placeOfSupply = placeOfSupplyOf(tenant);
  const invoiceNumber = await allocateInvoiceNumber(issuedAt);

  const patch = {
    invoice_number: invoiceNumber,
    invoice_issued_at: issuedAt.toISOString(),
    taxable_value_cents: taxableValueCents,
    cgst_cents: taxSplit.cgstCents,
    sgst_cents: taxSplit.sgstCents,
    igst_cents: taxSplit.igstCents,
    place_of_supply: placeOfSupply,
    document_label: label,
  };
  // Tenant-stamped even though the id is a primary key — service-role writes
  // must never be addressable by id alone. `.is("invoice_number", null)` makes
  // the stamp conditional so a concurrent issue of the SAME charge can't
  // overwrite the winner's number: the loser burns a number (a gap, which is
  // explainable) rather than replacing a number already sent out.
  const saved = await db().from("wa_billing_events").update(patch)
    .eq("id", ev.id).eq("tenant_id", ev.tenant_id).is("invoice_number", null)
    .select(EVENT_COLUMNS).maybeSingle();
  if (saved.error) {
    console.error(JSON.stringify({ at: "issueInvoiceForBillingEvent.stamp", billingEventId, tenantId: ev.tenant_id, error: saved.error.message }));
    return null;
  }
  if (saved.data) return assemble(saved.data as unknown as BillingEventRow, tenant, planName, planInterval);

  // Lost the race (or the row vanished): re-read and return whatever is
  // actually stamped on the row, so this charge still yields one document.
  const reread = await db().from("wa_billing_events").select(EVENT_COLUMNS).eq("id", billingEventId).maybeSingle();
  const winner = reread.data as unknown as BillingEventRow | null;
  if (!winner?.invoice_number) {
    console.error(JSON.stringify({ at: "issueInvoiceForBillingEvent.race", billingEventId, tenantId: ev.tenant_id, error: "no invoice number after stamp" }));
    return null;
  }
  return assemble(winner, tenant, planName, planInterval);
}
