import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { queueCounts, platformStatsFast, metricsFreshness } from "@/lib/ownermetrics";
import { getSetting } from "@/lib/store";
import { crmSyncStats } from "@/lib/leadsquared";
import { OPERATIONAL_MAX_MIN } from "@/lib/publicstatus";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — everything the Today screen needs, in a fixed number of round-trips that
// does not grow with the fleet.
//
// Every work-queue count comes from one owner_queue_counts() call (0106); the
// headline counters from one owner_platform_stats(). The old portal derived the
// equivalent by pulling every tenant row and looping in JS.
//
// `freshness` is deliberately part of the contract: the delivery/onboarding
// queues read tenant_metrics, which a cron refreshes on a rotation, so the UI has
// to be able to say "as of". Revenue and trial queues read `tenants` live and are
// never stale — the queue catalog marks which is which.
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const [queues, stats, freshness, tick, crm] = await Promise.all([
      queueCounts(),
      platformStatsFast(),
      metricsFreshness().catch(() => null),
      getSetting<string>("cron_last_tick", "").catch(() => ""),
      crmSyncStats().catch(() => ({ pending: 0, dead: 0 })),
    ]);

    // Platform liveness first: everything queue-driven dies silently with the
    // cron, so this is the one failure that affects every tenant at once.
    const cronAgeMin = tick ? Math.round((Date.now() - new Date(tick).getTime()) / 60_000) : null;

    return NextResponse.json({
      queues,
      stats,
      freshness,
      platform: {
        cronLastTick: tick || null,
        cronAgeMin,
        cronOk: cronAgeMin !== null && cronAgeMin <= OPERATIONAL_MAX_MIN,
        crmSync: crm,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
