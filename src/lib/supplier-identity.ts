// Who WE are on a billing document — the supplier side of an Indian GST tax
// invoice (CGST Rule 46(a)-(d): legal name, address, our GSTIN, the SAC of the
// service). The recipient side lives on the tenant row (migration 0110).
//
// READ THIS BEFORE ASSUMING WE ISSUE TAX INVOICES. Every statutory value here
// comes from an env var and there are NO defaults. Until TALKO_GSTIN,
// TALKO_STATE_CODE, TALKO_SAC_CODE and TALKO_ADDRESS_LINES are all set in the
// deployment, isTaxInvoiceReady() is false and documentLabel() returns
// "Payment Receipt" — the documents we hand customers are proof of payment
// only, they are NOT valid tax invoices and no customer can claim input tax
// credit against them. That is the correct, honest state for an unregistered
// or not-yet-configured supplier; the wrong state is a document that says "Tax
// Invoice" over a blank or invented GSTIN.
//
// Nothing is cached: these are read per call so setting the env vars takes
// effect on the next deploy without a code change, and tests can vary them.

import { LEGAL_META } from "@/app/(site)/_content/legal";

export interface SupplierIdentity {
  legalName: string;
  tradeName: string;
  gstin: string | null;
  addressLines: string[];
  stateName: string | null;
  stateCode: string | null;
  sacCode: string | null;
  signatory: string | null;
  cin: string | null;
  pan: string | null;
}

// 2-digit state code + 10-char PAN (5 letters, 4 digits, 1 letter) + entity
// code + the literal 'Z' + a checksum character = 15. Anything else is a typo
// or a placeholder, never a real registration.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function env(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

// A malformed GSTIN is treated as absent, not printed as-is. Showing a wrong
// number on a statutory document is worse than showing none: it looks valid to
// the customer, fails at their end when they try to claim credit, and is our
// mistake to correct — whereas a missing GSTIN downgrades the document to a
// receipt, which is merely accurate.
function readGstin(): string | null {
  const raw = env("TALKO_GSTIN");
  if (!raw) return null;
  const gstin = raw.toUpperCase();
  if (!GSTIN_RE.test(gstin)) {
    console.error(`[supplier-identity] TALKO_GSTIN is not a valid GSTIN (${raw}) — billing documents will be issued as Payment Receipts until it is corrected.`);
    return null;
  }
  return gstin;
}

export function supplierIdentity(): SupplierIdentity {
  const gstin = readGstin();
  const stateCode = env("TALKO_STATE_CODE");

  // The first two characters of a GSTIN ARE the state of registration, so a
  // disagreement here means one of the two is wrong — and this pair is exactly
  // what decides IGST vs CGST+SGST, so a silent mismatch charges the wrong tax
  // head. Log rather than guess: we cannot tell which of the two is the typo.
  if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) {
    console.error(`[supplier-identity] TALKO_STATE_CODE (${stateCode}) disagrees with the state prefix of TALKO_GSTIN (${gstin.slice(0, 2)}) — the CGST/SGST vs IGST split on invoices may be wrong.`);
  }

  return {
    // The only statutory field with a fallback, because LEGAL_META.legalEntity
    // is already the registered entity named in the Terms and Privacy Policy —
    // it is a real value, not a placeholder.
    legalName: env("TALKO_LEGAL_NAME") ?? LEGAL_META.legalEntity,
    // Branding, not statutory. LEGAL_META.company is the compile-time constant
    // "Talko AI", so this can never be empty.
    tradeName: LEGAL_META.company,
    gstin,
    // Pipe-separated so a multi-line registered address survives a single env
    // var; empty segments dropped so a trailing "|" doesn't print a blank line.
    addressLines: (env("TALKO_ADDRESS_LINES") ?? "").split("|").map(s => s.trim()).filter(Boolean),
    stateName: env("TALKO_STATE"),
    stateCode,
    // SAC (service accounting code) for the supply — Rule 46(f). Unset means we
    // genuinely don't know it; picking a plausible-looking code would be a
    // misclassification on every invoice we ever issue.
    sacCode: env("TALKO_SAC_CODE"),
    signatory: env("TALKO_SIGNATORY"),
    cin: env("TALKO_CIN"),
    pan: env("TALKO_PAN"),
  };
}

// The gate for the "Tax Invoice" label. Deliberately AND-ed over the four
// fields Rule 46 makes mandatory for the supplier — a document missing any one
// of them is not a tax invoice, however complete it looks.
export function isTaxInvoiceReady(): boolean {
  const s = supplierIdentity();
  return Boolean(s.gstin && s.stateCode && s.sacCode && s.addressLines.length);
}

export function documentLabel(): "Tax Invoice" | "Payment Receipt" {
  return isTaxInvoiceReady() ? "Tax Invoice" : "Payment Receipt";
}
