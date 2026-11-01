import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { razorpayConfigured } from "@/lib/razorpay";
import { cancelRazorpayAtPeriodEnd } from "@/lib/billing-cancel";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — cancel this workspace's Razorpay subscription at the end of the
// current paid period. Admins only. The plan stays active until then and is
// not charged again; Stripe subscriptions cancel through the billing portal
// instead (billing/portal with { flow: "cancel" }). See src/lib/billing-cancel.ts.
export async function POST() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!razorpayConfigured()) return NextResponse.json({ error: "Online billing isn't enabled — contact support to cancel." }, { status: 503 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const out = await cancelRazorpayAtPeriodEnd(tenant, (await currentUser())?.email ?? "tenant");
    return NextResponse.json(out.body, { status: out.status });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
