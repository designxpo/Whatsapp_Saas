import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { listTenants, updateTenant, deleteTenant, getTenant, platformStats, listOwnerAudit, ownerAudit, type TenantStatus, type PaymentStatus, type TenantFeatures } from "@/lib/tenants";
import { getEntitlements } from "@/lib/entitlements";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — every tenant + platform stats + recent owner actions (owner only). The
// per-tenant `features` are the RESOLVED effective entitlements (plan ⊕ override,
// or all-on if grandfathered) so the editor reflects what the tenant actually has.
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const [tenants, stats, audit] = await Promise.all([listTenants(), platformStats(), listOwnerAudit(40)]);
    const ents = await Promise.all(tenants.map(t => getEntitlements(t.id).catch(() => null)));
    const enriched = tenants.map((t, i) => ({ ...t, features: ents[i]?.features ?? t.features }));
    return NextResponse.json({ tenants: enriched, stats, audit });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH — update one tenant's subscription / features / grandfathering (owner only).
export async function PATCH(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string; status?: TenantStatus; plan?: string; paymentStatus?: PaymentStatus; trialEndsAt?: string | null; amountCents?: number; currency?: string; notes?: string; features?: Partial<TenantFeatures>; grandfathered?: boolean };
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

// DELETE — permanently remove a tenant (requires exact name confirmation).
export async function DELETE(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string; confirmName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const t = await getTenant(body.id);
    if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if ((body.confirmName ?? "").trim() !== (t.company || t.name)) return NextResponse.json({ error: "Type the tenant name exactly to confirm deletion" }, { status: 400 });
    await deleteTenant(body.id);
    await ownerAudit((await currentUser())?.email ?? "owner", "tenant.delete", null, t.company || t.name);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
