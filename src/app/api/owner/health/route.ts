import { NextResponse, after } from "next/server";
import { kickIfStalled } from "@/lib/cronwatchdog";
import { isPlatformOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { metricsFreshness } from "@/lib/ownermetrics";
import { getSetting } from "@/lib/store";
import { crmSyncStats } from "@/lib/leadsquared";
import { errorMessage } from "@/lib/errors";
import { OPERATIONAL_MAX_MIN } from "@/lib/publicstatus";

export const dynamic = "force-dynamic";

// GET — fleet health as COUNTS BY FAILURE CLASS, plus platform subsystems.
//
// This route used to call listTenants() (1 + 2N) and then getTenantHealthSummary()
// for every tenant (five sub-calls each) — roughly 1 + 8N round-trips inside a
// 60-second budget, and it returned one row per tenant. Both halves were wrong at
// scale: the cost, and the idea that an operator wants to scroll 100k health rows.
//
// What an operator actually needs is "how many are broken, in which way" and a
// way into each group. The per-tenant detail lives one click away, in the tenant
// list filtered by that class. All of this is now indexed COUNTs against
// tenant_metrics, so the cost is flat in fleet size.
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  after(() => kickIfStalled("owner-health"));   // same reasoning as owner/queues
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const head = () => db().from("tenant_metrics").select("tenant_id", { count: "exact", head: true });

    const [
      total, ok, warn, error,
      waRed, waFlagged, paused, integrations, silent, noChannel, noAi, nearLimit,
      freshness, tick, crm,
    ] = await Promise.all([
      head(),
      head().eq("health", "ok"),
      head().eq("health", "warn"),
      head().eq("health", "error"),
      head().eq("wa_quality", "RED"),
      head().in("wa_health", ["FLAGGED", "RESTRICTED"]),
      head().eq("marketing_paused", true),
      head().gt("integrations_errored", 0),
      head().gt("channels", 0).lt("last_inbound_at", weekAgo),
      head().eq("channels", 0),
      head().eq("ai_configured", false),
      head().gte("usage_pct_max", 80),
      metricsFreshness().catch(() => null),
      getSetting<string>("cron_last_tick", "").catch(() => ""),
      crmSyncStats().catch(() => ({ pending: 0, dead: 0 })),
    ]);

    const n = (r: { count: number | null }) => r.count ?? 0;
    const cronAgeMin = tick ? Math.round((Date.now() - new Date(tick).getTime()) / 60_000) : null;

    return NextResponse.json({
      // Roll-up, for the headline.
      fleet: { total: n(total), ok: n(ok), warn: n(warn), error: n(error) },
      // Each class maps to a queue key, so the UI can link straight into the
      // filtered tenant list rather than inventing its own filters.
      classes: [
        { key: "wa_quality", label: "WhatsApp quality RED", count: n(waRed), severity: "critical" },
        { key: "wa_quality", label: "Flagged or restricted", count: n(waFlagged), severity: "critical" },
        { key: "marketing_paused", label: "Marketing paused", count: n(paused), severity: "critical" },
        { key: "integrations_errored", label: "Integration errors", count: n(integrations), severity: "warn" },
        { key: "channel_silent", label: "Nothing received in 7 days", count: n(silent), severity: "warn" },
        { key: "no_channel", label: "No channel connected", count: n(noChannel), severity: "warn" },
        { key: "no_ai_key", label: "No AI key", count: n(noAi), severity: "info" },
        { key: "near_limit", label: "Near a plan limit", count: n(nearLimit), severity: "info" },
      ],
      // Everything above is a rotation snapshot — say when, don't imply "now".
      freshness,
      // Platform subsystems: the failures that hit every tenant at once. The cron
      // threshold is shared with the public /status page so the two can't drift.
      platform: {
        cronLastTick: tick || null,
        cronAgeMin,
        cronOk: cronAgeMin !== null && cronAgeMin <= OPERATIONAL_MAX_MIN,
        crmSync: crm,
      },
    });
  } catch (err) {
    const msg = errorMessage(err);
    return NextResponse.json({
      error: /tenant_metrics|relation/i.test(msg) ? `${msg} — apply migration 0106_owner_console.sql` : msg,
    }, { status: 500 });
  }
}
