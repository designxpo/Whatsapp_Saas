import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { stripeConfigured, createBillingPortalSession } from "@/lib/stripe";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — open the Stripe billing portal (update card, cancel, invoices). Admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!stripeConfigured()) return NextResponse.json({ error: "Billing isn't enabled yet (STRIPE_SECRET_KEY unset)." }, { status: 503 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (!tenant.stripeCustomerId) return NextResponse.json({ error: "No subscription yet — choose a plan first." }, { status: 400 });
    // Stripe returns to `${baseUrl}/admin/billing`, a PORTAL path — use the app
    // host (NEXT_PUBLIC_APP_URL), not the marketing NEXT_PUBLIC_SITE_URL which
    // would 404 under the host split. Falls back to the request origin.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const url = await createBillingPortalSession(tenant, `${baseUrl}/admin/billing`);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
