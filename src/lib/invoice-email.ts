// The email that hands a customer the billing document for a charge they have
// already paid: a GST tax invoice once supplier-identity.ts has everything Rule
// 46 needs, an honest payment receipt until then.
//
// Presentation only. Every statutory value comes from
// issueInvoiceForBillingEvent() and nothing here recomputes an amount — the one
// judgement this file makes about numbers is at taxRows(), which decides whether
// the figures on the row actually support printing a rate beside the tax head.
//
// Transactional: this is the record of a payment the recipient made on an
// account they own, so there's no unsubscribe link (same reasoning as
// dunning.ts).
//
// Idempotency: a renewal must never email two copies of the same numbered
// document, so the send sits behind an atomic compare-and-set on
// wa_billing_events.invoice_emailed_at — NOT claimWebhookEvent(), whose dedup
// rows pruneEphemeral() deletes after 48h. That window is fine for a dunning
// notice and wrong for a tax invoice: a redelivery or backfill on day three
// would send a second copy of a document already in the customer's books.
//
// The claim is taken AFTER the document is issued but BEFORE the send: issuing
// is itself idempotent, so ordering it that way lets a retry after a failed
// issue still get the email out, whereas claiming first would burn the claim on
// an attempt that never rendered anything. It is handed back only when the
// provider explicitly reports a failed send — a crash mid-send leaves it
// standing, because a duplicate invoice number is worse than a resend request.

import { db } from "./supabase";
import { sendEmail } from "./email";
import { renderEmail, type EmailLineItem, type EmailMetaRow } from "./emailtemplate";
import { SITE_URL } from "./siteurl";
import { GST_RATE } from "./billing-tax";
import { invoiceMoney, issueInvoiceForBillingEvent, type InvoiceData } from "./invoice";

// Same reasoning as dunning.ts's FIX_BILLING: /admin/billing 404s on the
// marketing host, so route through /login, which redirects to the app host and
// lands on billing after sign-in.
const VIEW_BILLING = "/login?next=/admin/billing";

// "3 Aug 2026", in IST — the same zone invoice.ts numbers the series in. A UTC
// date printed beside an IST-derived invoice number would let a late-evening
// renewal show 31 March under a 2027-28 number, which is a filing question
// nobody wants to answer twice.
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

// A postal address stored as one multi-line string has to collapse to a single
// line: metaRows renders its value in one cell and the template escapes the
// newlines rather than honouring them.
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Razorpay reports the instrument lowercase. Only the acronyms need spelling
// out; everything else just wants a capital, so an instrument we haven't seen
// before still prints as a word rather than being dropped.
const METHOD_LABELS: Record<string, string> = {
  card: "Card", upi: "UPI", netbanking: "Net banking", wallet: "Wallet",
  emi: "EMI", nach: "NACH", emandate: "e-Mandate", paylater: "Pay later",
};

function methodLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  return METHOD_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

// "18%", "9%" — trailing zeros trimmed so the common whole-number rates don't
// read as "18.00%". Derived from GST_RATE rather than written as literals, so a
// statutory rate change stays a one-line edit in billing-tax.ts.
function ratePct(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}

/**
 * The Rule 46 particulars, in reading order: which document this is, when the
 * money moved, who it was billed to, what it covered, how it was paid, and who
 * we are for tax purposes.
 *
 * The GST-specific rows are gated on isTaxInvoice because a receipt makes no
 * tax claims at all — and gated again on the individual value, because a
 * particular we genuinely don't have is omitted rather than printed as a dash or
 * a placeholder. (The supplier rows are re-checked against the values rather
 * than trusted from the label: the label was stamped when the charge was
 * documented, and the env behind supplier-identity.ts can have changed since.)
 */
function metaRows(inv: InvoiceData): EmailMetaRow[] {
  const paidOn = day(inv.periodStart);
  const rows: EmailMetaRow[] = [
    { label: inv.documentLabel, value: inv.invoiceNumber },
    { label: "Date of payment", value: paidOn },
  ];
  // Rule 46(b) wants the date of issue as well, but only worth its own row when
  // it differs from the payment date — a document re-issued later, or one issued
  // either side of midnight IST.
  const issuedOn = day(inv.issuedAt);
  if (inv.isTaxInvoice && issuedOn !== paidOn) rows.push({ label: "Date of issue", value: issuedOn });

  rows.push({ label: "Billed to", value: inv.recipient.legalName });
  if (inv.isTaxInvoice && inv.recipient.address) rows.push({ label: "Billing address", value: oneLine(inv.recipient.address) });
  // "Unregistered" is a statement, not a placeholder: a B2C customer has no
  // GSTIN, and saying so is what tells them why they can't claim credit.
  if (inv.isTaxInvoice) rows.push({ label: "Customer GSTIN", value: inv.recipient.gstin ?? "Unregistered" });
  if (inv.isTaxInvoice && inv.placeOfSupply) rows.push({ label: "Place of supply", value: inv.placeOfSupply });

  rows.push({ label: "Billing period", value: `${paidOn} – ${day(inv.periodEnd)}` });
  if (inv.paymentMethod) rows.push({ label: "Paid by", value: methodLabel(inv.paymentMethod) });
  // Not statutory, but it's the handle support and the customer's own bank
  // statement have in common when a charge is queried.
  if (inv.providerPaymentId) rows.push({ label: "Payment reference", value: inv.providerPaymentId });

  if (inv.isTaxInvoice && inv.supplier.gstin) rows.push({ label: "Our GSTIN", value: inv.supplier.gstin });
  if (inv.isTaxInvoice && inv.sacCode) rows.push({ label: "SAC code", value: inv.sacCode });
  return rows;
}

/**
 * The tax rows. The head (CGST+SGST vs IGST) is Rule 46(m)'s and comes straight
 * from the stored split; the RATE beside it is only printed when the row's own
 * numbers support it.
 *
 * Why the rate is conditional: under the legacy gross-up (see billing-tax.ts)
 * the recorded tax is 18% of the base while the taxable value also includes the
 * gateway fee, so "@ 18%" sitting next to those two figures is arithmetic the
 * reader can disprove with a calculator. Where that's the case we print the head
 * alone, and the rate reappears on its own the day checkout moves to the
 * compliant breakdown. A rate the document contradicts is worse than a missing
 * one; a rate invented to fit (17.51%) would be worse than both.
 */
function taxRows(inv: InvoiceData): EmailLineItem[] {
  const t = inv.taxSplit;
  if (t.totalTaxCents <= 0) return [];
  const amount = (cents: number) => invoiceMoney(cents, inv.currency);
  // ±1 paisa: splitTax() and the checkout math both round to whole paise.
  const stateable = Math.abs(t.totalTaxCents - Math.round(inv.taxableValueCents * GST_RATE)) <= 1;
  const head = (label: string, rate: number) => (stateable ? `${label} @ ${ratePct(rate)}` : label);

  if (t.kind === "cgst_sgst") {
    return [
      { label: head("CGST", GST_RATE / 2), amount: amount(t.cgstCents) },
      { label: head("SGST", GST_RATE / 2), amount: amount(t.sgstCents) },
    ];
  }
  if (t.kind === "igst") return [{ label: head("IGST", GST_RATE), amount: amount(t.igstCents) }];
  // "none": place of supply wasn't determinable when the charge was documented,
  // so neither head can be asserted. The tax is still money the customer paid
  // and has to appear on the document — unheaded rather than guessed.
  return [{ label: "GST", amount: amount(t.totalTaxCents) }];
}

/**
 * The priced rows, built so the column visibly reconciles: plan + gateway fee =
 * taxable value, taxable value + tax = the total actually charged (which holds
 * under both gross-up models — see issueInvoiceForBillingEvent).
 */
function lineItems(inv: InvoiceData): EmailLineItem[] {
  const amount = (cents: number) => invoiceMoney(cents, inv.currency);
  const items: EmailLineItem[] = [{ label: `${inv.planName} subscription`, amount: amount(inv.baseAmountCents) }];

  // The gateway fee is recovered FROM the customer, so under s.15 it's part of
  // the value of supply and belongs above the tax rows, not after the total.
  // Taken as the difference from the taxable value rather than read from
  // gatewayFeeEstimateCents — the two are equal by construction (invoice.ts) and
  // this way the printed column always sums to the taxable value it claims. A
  // document that adds up is worth more than one that names its residual
  // precisely. When there's no fee the plan row already IS the taxable value, so
  // restating it as a subtotal would just be a duplicate line.
  const otherCharges = inv.taxableValueCents - inv.baseAmountCents;
  if (otherCharges > 0) {
    items.push({ label: "Payment gateway fee", amount: amount(otherCharges) });
    items.push({ label: "Taxable value", amount: amount(inv.taxableValueCents), strong: true });
  }

  return [...items, ...taxRows(inv)];
}

// The small print carries the one thing the reader most needs to know about the
// document's standing, which is different in each direction: a receipt has to
// say out loud that it won't support an input-tax-credit claim, and a tax
// invoice has to carry the reverse-charge declaration and name who issued it.
function disclaimer(inv: InvoiceData): string {
  if (!inv.isTaxInvoice) {
    return "This is a payment receipt confirming the amount charged. It is not a valid tax invoice under the CGST Act, 2017, and cannot be used to claim input tax credit. If you need a tax invoice, reply to this email and we'll sort it out.";
  }
  const by = inv.supplier.signatory ? ` by ${inv.supplier.signatory}, authorised signatory` : "";
  return `Tax is not payable on reverse charge basis. Issued electronically for ${inv.supplier.legalName}${by}.`;
}

/**
 * Issue (or re-read) the document for one charge and email it to the customer.
 *
 * Returns true only when an email actually went out: false covers a charge or
 * tenant that's gone, a workspace with no owner email, and a duplicate call for
 * a charge already emailed.
 */
export async function sendInvoiceEmail(billingEventId: string): Promise<boolean> {
  const inv = await issueInvoiceForBillingEvent(billingEventId);
  if (!inv) return false;   // invoice.ts already logged which step failed

  const to = inv.recipient.email;
  if (!to) {
    // Worth a log where a missing owner email elsewhere isn't: a number has come
    // off the Rule 46(b) series and the document it belongs to has nowhere to go.
    console.error("[invoice-email] no recipient email", billingEventId, inv.invoiceNumber);
    return false;
  }

  // One email per charge, FOREVER — and that word is why this is a row update
  // rather than claimWebhookEvent(). store.ts's pruneEphemeral() drops dedup
  // rows after 48h, so a redelivery, backfill or support replay two days later
  // would send a second copy of an already-numbered document. A dunning notice
  // survives that; a tax invoice does not.
  //
  // `update … where invoice_emailed_at is null` is a single atomic
  // compare-and-set: two concurrent deliveries both issue the UPDATE, exactly
  // one matches a row, and the loser gets an empty result and stops here.
  const { data: claimed, error: claimErr } = await db().from("wa_billing_events")
    .update({ invoice_emailed_at: new Date().toISOString() })
    .eq("id", billingEventId).is("invoice_emailed_at", null)
    .select("id");
  // Fail CLOSED, unlike claimWebhookEvent (which returns true on a broken dedup
  // table so a notice still goes out). If we cannot prove this document has not
  // already been emailed, not sending is the recoverable outcome — the invoice
  // and its number are already persisted, so it can be re-sent deliberately.
  if (claimErr) {
    console.error("[invoice-email] could not claim send", billingEventId, inv.invoiceNumber, claimErr.message);
    return false;
  }
  if (!claimed?.length) return false;   // already emailed

  const total = invoiceMoney(inv.totalChargedCents, inv.currency);
  const doc = inv.documentLabel.toLowerCase();

  const { html, text } = renderEmail({
    preheader: `${total} for your ${inv.planName} subscription — nothing needed from you.`,
    heading: "Payment received",
    headerAlign: "center",
    successMark: true,
    paragraphs: [
      `We've received ${total} for your ${inv.planName} subscription, covering ${day(inv.periodStart)} to ${day(inv.periodEnd)}.`,
      `This is your ${doc}, ${inv.invoiceNumber}. Keep it for your records — nothing needs doing.`,
    ],
    metaRows: metaRows(inv),
    lineItems: lineItems(inv),
    total: { label: "Total paid", amount: total },
    cta: { label: "View your subscription", href: VIEW_BILLING },
    disclaimer: disclaimer(inv),
    addressLines: inv.supplier.addressLines,
    footerReason: "You're getting this because a subscription payment on your Talko AI workspace went through. It's the billing document for that charge — one per payment, with nothing recurring to unsubscribe from.",
  }, SITE_URL);

  // Label and number both in the subject: this is the mail someone digs out of a
  // year-old inbox at filing time, and the number is what they'll search for.
  const result = await sendEmail({ to, subject: `Talko AI ${inv.documentLabel} ${inv.invoiceNumber}`, html, text });
  if (!result.ok) {
    console.error("[invoice-email] send failed", billingEventId, inv.invoiceNumber, result.error);
    // Hand the claim back on an EXPLICIT failure so the next webhook delivery
    // retries. Deliberately not in a finally: a crash between the send and here
    // must leave the claim standing, because a duplicate numbered tax invoice is
    // worse than one the customer has to ask us to resend. Only a provider that
    // told us it did not send reopens the door.
    await db().from("wa_billing_events").update({ invoice_emailed_at: null }).eq("id", billingEventId);
  }
  return result.ok;
}
