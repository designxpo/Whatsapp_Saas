import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant, ownerAudit } from "@/lib/tenants";
import { getPlan } from "@/lib/plans";
import { stripeConfigured, createCheckoutSession } from "@/lib/stripe";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { planKey } — start a Stripe Checkout for a subscription. Admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!stripeConfigured()) return NextResponse.json({ error: "Billing isn't enabled yet (STRIPE_SECRET_KEY unset)." }, { status: 503 });
  let body: { planKey?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.planKey?.trim()) return NextResponse.json({ error: "planKey required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const plan = await getPlan(body.planKey.trim());
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (!plan.stripePriceId) return NextResponse.json({ error: `"${plan.name}" isn't purchasable yet — no Stripe price configured.` }, { status: 400 });
    // Stripe returns the user to `${baseUrl}/admin/billing`, a PORTAL path — so
    // this must be the app host, NOT the marketing NEXT_PUBLIC_SITE_URL (which
    // would 404 under the host split). Prefer NEXT_PUBLIC_APP_URL; fall back to
    // the request origin (already the app host, since this API is called there).
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const url = await createCheckoutSession(tenant, plan, baseUrl);
    await ownerAudit((await currentUser())?.email ?? "tenant", "billing.checkout", tid, plan.key);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
