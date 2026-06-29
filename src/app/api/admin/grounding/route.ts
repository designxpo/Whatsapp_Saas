import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listGroundingAudits, groundingStats } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET — the grounding health panel: recent flagged (likely-hallucinated) replies
// + aggregate deferral/flag rates, scoped to the current tenant. Read-only.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [flagged, stats] = await Promise.all([
    listGroundingAudits({ tenantId: tid, limit: 50, onlyFlagged: true }).catch(() => []),
    groundingStats(tid, 7).catch(() => ({ deferred: 0, flagged: 0, audited: 0 })),
  ]);
  return NextResponse.json({ flagged, stats });
}
