import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { listTenants } from "@/lib/tenants";
import { getTenantHealthSummary } from "@/lib/setupstatus";
import { getSetting } from "@/lib/store";
import { crmSyncStats } from "@/lib/leadsquared";
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
        ai: { configured: false }, kb: { ready: 0, total: 0 }, crm: { configured: false }, integrations: { active: 0, errored: 0 }, health: "error" as const,
      }))),
    })));
    // Broken/at-risk tenants first.
    const rank = { error: 0, warn: 1, todo: 2, ok: 3 } as const;
    health.sort((a, b) => rank[a.health] - rank[b.health]);

    // Platform liveness (P5): is the shared cron actually ticking (GitHub
    // Actions pinger — everything queue-driven dies silently with it), and is
    // the CRM sync backlog healthy across tenants?
    const tick = await getSetting<string>("cron_last_tick", "").catch(() => "");
    const cronAgeMin = tick ? Math.round((Date.now() - new Date(tick).getTime()) / 60_000) : null;
    const crm = await crmSyncStats().catch(() => ({ pending: 0, dead: 0 }));
    // Threshold is generous: SaaS cron is the */5 GitHub-Actions pinger (no
    // vercel.json on Hobby), and GH schedules routinely run minutes late at
    // peak — a tight bound would flap red and train alarm-blindness.
    const platform = {
      cronLastTick: tick || null,
      cronAgeMin,
      cronOk: cronAgeMin !== null && cronAgeMin <= 20,
      crmSync: crm,
    };

    return NextResponse.json({ tenants: health, platform });
  } catch (err) {
    return NextResponse.json({ tenants: [], error: errorMessage(err) }, { status: 500 });
  }
}
