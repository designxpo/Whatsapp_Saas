import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { getEntitlements } from "@/lib/entitlements";
import { getTenantUsage, getPlanLimits } from "@/lib/usage";
import { listChannels } from "@/lib/channels";
import { db } from "@/lib/supabase";
import { mapMetrics } from "@/lib/ownermetrics";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — everything about ONE tenant, for the drawer.
//
// This is where the expensive per-tenant work belongs. The list route used to do
// all of it for every row on every page load; here it runs once, for the single
// account an operator actually opened.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  try {
    const tenant = await getTenant(id);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const [ent, usage, limits, channels, metricsRow, audit] = await Promise.all([
      getEntitlements(id).catch(() => null),
      getTenantUsage(id).catch(() => null),
      getPlanLimits(id).catch(() => null),
      listChannels(id).catch(() => []),
      db().from("tenant_metrics").select("*").eq("tenant_id", id).maybeSingle().then(r => r.data, () => null),
      db().from("wa_owner_audit").select("actor_email,action,detail,created_at")
        .eq("tenant_id", id).order("created_at", { ascending: false }).limit(25)
        .then(r => r.data ?? [], () => []),
    ]);

    return NextResponse.json({
      tenant: {
        ...tenant,
        // The RESOLVED entitlements (plan ⊕ override, or all-on if grandfathered)
        // so the editor reflects what this tenant actually has, not the raw column.
        features: ent?.features ?? tenant.features,
      },
      usage, limits,
      // Never the token — this payload is read in a browser.
      channels: channels.map(c => ({
        id: c.id, kind: c.kind, name: c.name, active: c.active,
        qualityRating: c.qualityRating, messagingHealth: c.messagingHealth, marketingPaused: c.marketingPaused,
      })),
      metrics: metricsRow ? mapMetrics(metricsRow as Record<string, unknown>) : null,
      audit: ((audit ?? []) as Record<string, unknown>[]).map(a => ({
        actorEmail: a.actor_email, action: a.action, detail: a.detail, at: a.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
