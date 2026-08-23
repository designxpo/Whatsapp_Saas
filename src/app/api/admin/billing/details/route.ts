import { NextResponse } from "next/server";
import { requireAdmin, requireRoleAdmin, currentTenantId, currentUser } from "@/lib/auth";
import { getTenant, setBillingDetails, hasBillingIdentity, ownerAudit, type Tenant } from "@/lib/tenants";
import { isTaxInvoiceReady } from "@/lib/supplier-identity";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// The RECIPIENT block of a GST invoice — who the CUSTOMER is, as opposed to the
// supplier side in src/lib/supplier-identity.ts. Split out of billing/route.ts
// because it is a write surface with statutory validation: a wrong value here
// doesn't merely look bad on a page, it names the wrong party on a tax document
// and can charge the wrong tax head.
//
// Same shape as the supplier's own number: 2-digit state code + 10-char PAN
// (5 letters, 4 digits, 1 letter) + entity code + the literal 'Z' + checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function detailsPayload(t: Tenant) {
  return {
    details: {
      gstin: t.gstin, billingLegalName: t.billingLegalName, billingAddress: t.billingAddress,
      billingState: t.billingState, billingStateCode: t.billingStateCode, billingCountry: t.billingCountry ?? "IN",
    },
    // hasBillingIdentity() accepts the company name in place of a legal name, so
    // `complete` can be true with billingLegalName still null — the form prefills
    // from this rather than showing an empty box for a field already satisfied.
    company: t.company,
    complete: hasBillingIdentity(t),
    // Whether a GSTIN can actually buy this customer input tax credit. False
    // while we're issuing payment receipts rather than tax invoices, so the form
    // never promises ITC we can't deliver (see isTaxInvoiceReady()).
    taxInvoiceReady: isTaxInvoiceReady(),
  };
}

// GET — the tenant's saved billing identity + whether it's enough to invoice.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    return NextResponse.json(detailsPayload(tenant));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH { billingLegalName, billingAddress, billingStateCode, billingState?, gstin?, billingCountry? }
export async function PATCH(req: Request) {
  // Gated like every other write in this folder (checkout/portal/request) rather
  // than with the weaker requireAdmin() used by the reads above — this decides
  // whose name and tax registration appear on a statutory document.
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  // Always the session's tenant, never a body field: a tenant id from the
  // request would let one workspace stamp its GST identity onto another's row.
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { gstin?: unknown; billingLegalName?: unknown; billingAddress?: unknown; billingState?: unknown; billingStateCode?: unknown; billingCountry?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const legalName = str(body.billingLegalName);
  const address = str(body.billingAddress);
  const stateName = str(body.billingState);
  const stateCode = str(body.billingStateCode);
  const gstin = str(body.gstin).toUpperCase();
  const country = str(body.billingCountry).toUpperCase();

  // One message per field, naming the field. This form blocks a payment, so a
  // generic "invalid input" would leave the customer guessing which of five
  // boxes is standing between them and a subscription.
  if (!legalName) return NextResponse.json({ error: "Registered name is required — the legal name of the business or person we should invoice.", field: "billingLegalName" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "Billing address is required — it is printed as the recipient address on your invoice.", field: "billingAddress" }, { status: 400 });
  if (!/^[0-9]{2}$/.test(stateCode)) return NextResponse.json({ error: "Select your state — its 2-digit GST state code is what decides whether we charge CGST+SGST or IGST.", field: "billingStateCode" }, { status: 400 });
  if (gstin && !GSTIN_RE.test(gstin)) return NextResponse.json({ error: "That GSTIN doesn't look right — it must be 15 characters: a 2-digit state code, a 10-character PAN, then 3 more (like 27AAAAA0000A1Z5). Leave it blank if you aren't GST-registered.", field: "gstin" }, { status: 400 });
  // The first two digits of a GSTIN ARE its state of registration, and for a
  // registered recipient that state is the place of supply — so a mismatch here
  // would invoice the wrong tax head. We can't tell which of the two is the
  // typo, so we ask rather than silently rewriting one of them.
  if (gstin && gstin.slice(0, 2) !== stateCode) return NextResponse.json({ error: `Your GSTIN is registered in state code ${gstin.slice(0, 2)} but you selected ${stateCode} — pick the state your GSTIN belongs to (a GSTIN's first two digits are its state code).`, field: "billingStateCode" }, { status: 400 });
  if (country && !/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: "Country must be a 2-letter ISO code — IN for India.", field: "billingCountry" }, { status: 400 });

  try {
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const saved = {
      billingLegalName: legalName, billingAddress: address,
      // The code is what the tax split is computed from; the state NAME is only
      // the label printed beside it, so a missing name isn't worth failing a
      // save over — the picker in the UI always sends the matching pair.
      billingState: stateName || null, billingStateCode: stateCode,
      gstin: gstin || null, billingCountry: country || "IN",
    };
    await setBillingDetails(tid, saved);
    await ownerAudit((await currentUser())?.email ?? "tenant", "billing.details_saved", tid,
      gstin ? `GSTIN ${gstin} · state ${stateCode}` : `unregistered · state ${stateCode}`);
    // Echo the merged tenant rather than re-reading it — the update above is the
    // only writer of these columns, so a second round trip would tell us nothing.
    return NextResponse.json({ success: true, ...detailsPayload({ ...tenant, ...saved }) });
  } catch (err) {
    const msg = errorMessage(err);
    // Migration 0110 adds these columns. Until it's applied the write fails with
    // a raw Postgres "column does not exist", which reads to the customer like
    // their address was rejected — say what's actually wrong instead. Same
    // missing-column signature describeChannelSaveError() tests for.
    if (/column .* does not exist|PGRST204|\b42703\b/i.test(msg)) {
      return NextResponse.json({ error: "Billing details can't be saved yet — this database is missing the invoicing migration (0110). Tell us and we'll apply it." }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
