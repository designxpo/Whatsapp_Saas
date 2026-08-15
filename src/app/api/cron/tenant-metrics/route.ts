export const maxDuration = 300;
import { NextResponse } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { refreshTenantMetrics, metricsFreshness, backfillMetricsRows } from "@/lib/ownermetrics";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Owner-console fleet metrics sweep.
//
// Deliberately NOT a stage inside /api/cron/process-queue. That route is already
// deadline-saturated (DEADLINE = 45s across ~20 stages, each conditional on the
// remaining budget), so a fleet sweep appended there would simply be starved by
// the message-delivery stages in front of it — and message delivery must always
// win. This gets its own invocation and its own budget.
//
// The sweep is a round-robin: it always takes the least-recently-refreshed rows,
// so every tenant is reached eventually and nothing starves. Fully idempotent —
// overlapping ticks just recompute the same rows, so a late or doubled GitHub
// Actions run is harmless.
//
// Nothing here is on a customer's critical path: if this stops, the console's
// derived numbers go stale and say so ("as of"), while money and trial queues —
// which read `tenants` live — stay correct.
const DEADLINE = 240_000;   // leave ~60s of the 300s budget as headroom

export async function POST(req: Request) {
  if (!cronOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  try {
    // Pick up tenants that have no metrics row yet, whatever created them.
    const seeded = await backfillMetricsRows();
    const swept = await refreshTenantMetrics(2000, startedAt + DEADLINE);
    const freshness = await metricsFreshness().catch(() => null);
    return NextResponse.json({
      ...swept,
      seeded,
      tookMs: Date.now() - startedAt,
      // oldest = the far end of the rotation, i.e. the true staleness ceiling.
      freshness,
    });
  } catch (err) {
    console.error("[cron] tenant-metrics", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// GitHub Actions can only issue a simple request; accept GET too.
export async function GET(req: Request) {
  return POST(req);
}
