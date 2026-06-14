import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { listTenants, updateTenant, platformStats, listOwnerAudit, ownerAudit, type TenantStatus, type PaymentStatus, type TenantFeatures } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — every tenant + platform stats + recent owner actions (owner only).
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const [tenants, stats, audit] = await Promise.all([listTenants(), platformStats(), listOwnerAudit(40)]);
    return NextResponse.json({ tenants, stats, audit });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH — update one tenant's subscription / features (owner only).
export async function PATCH(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string; status?: TenantStatus; plan?: string; paymentStatus?: PaymentStatus; trialEndsAt?: string | null; amountCents?: number; currency?: string; notes?: string; features?: Partial<TenantFeatures> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await updateTenant(body.id, body);
    const actor = (await currentUser())?.email ?? "owner";
    const what = body.status ? `status=${body.status}` : body.plan ? `plan=${body.plan}` : body.paymentStatus ? `payment=${body.paymentStatus}` : body.features ? "features" : "update";
    await ownerAudit(actor, "tenant.update", body.id, what);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0024 is applied` }, { status: 500 });
  }
}
