import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenant, ownerAudit } from "@/lib/tenants";
import { getPlan } from "@/lib/plans";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { planKey } — a tenant requests a plan change. When self-serve Stripe
// checkout isn't enabled, billing is team-managed: this records the request to
// the owner audit log so the platform owner sees it in the Owner Portal and can
// switch the tenant's plan. Admins only; always scoped to the caller's tenant.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { planKey?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.planKey?.trim()) return NextResponse.json({ error: "planKey required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const tenant = await getTenant(tid);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    const plan = await getPlan(body.planKey.trim());
    const planName = plan?.name ?? body.planKey.trim();
    const who = (await currentUser())?.email ?? tenant.ownerEmail ?? "tenant";
    await ownerAudit(who, "billing.request", tid, `requested ${planName} (currently ${tenant.plan})`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
