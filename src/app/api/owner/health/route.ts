import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { listTenants } from "@/lib/tenants";
import { getTenantHealthSummary } from "@/lib/setupstatus";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — every tenant's setup health (owner only). Lightweight DB-only rollup so
// one broken tenant is instantly visible; never throws per-tenant.
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const tenants = await listTenants();
    const health = await Promise.all(tenants.map(async t => ({
      id: t.id,
      name: t.company || t.name,
      status: t.status,
      plan: t.plan,
      ...(await getTenantHealthSummary(t.id).catch(() => ({
        whatsapp: { configured: false, flag: null }, instagram: { configured: false },
        ai: { configured: false }, kb: { ready: 0, total: 0 }, crm: { configured: false }, health: "error" as const,
      }))),
    })));
    // Broken/at-risk tenants first.
    const rank = { error: 0, warn: 1, todo: 2, ok: 3 } as const;
    health.sort((a, b) => rank[a.health] - rank[b.health]);
    return NextResponse.json({ tenants: health });
  } catch (err) {
    return NextResponse.json({ tenants: [], error: errorMessage(err) }, { status: 500 });
  }
}
