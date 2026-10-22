import { NextRequest, NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getDripAnalytics } from "@/lib/sequences";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — funnel and conversion metrics for this tenant's drip journeys.
//
// Query params:
//   sequenceId – one journey's uuid, or "all" (default)
//   range      – "all" (default), "today", "7d", "14d", "30d", "90d";
//                "today" is the BUSINESS day, not the UTC one
//   status     – "all" | "active" | "completed" | "stopped" | "failed"
//   platform   – "all" | "whatsapp" | "instagram"
export async function GET(req: NextRequest) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    const url = new URL(req.url);
    const analytics = await getDripAnalytics({
      sequenceId: url.searchParams.get("sequenceId") || undefined,
      range: url.searchParams.get("range") || undefined,
      status: url.searchParams.get("status") || undefined,
      platform: url.searchParams.get("platform") || undefined,
    }, tid);
    return NextResponse.json(analytics);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
