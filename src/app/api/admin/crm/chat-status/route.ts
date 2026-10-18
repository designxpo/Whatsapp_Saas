import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { crmChatStatuses } from "@/lib/leadsquared";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — per-conversation LeadSquared push status for the whole inbox.
//
// Separate from /api/admin/crm/health on purpose. That one is a handful of
// counters for the status bar and stays tiny; this is a row per in-flight
// conversation, so keeping them apart lets the bar poll without dragging the map
// along. Both are DB counters only — no LeadSquared round trip.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    return NextResponse.json(await crmChatStatuses(tid));
  } catch (err) {
    // Per-chat markers are an overlay on the inbox; a failure here must never be
    // the reason Live Chat won't load. Answer "we don't know" and let the list
    // render without them.
    return NextResponse.json({ configured: false, statuses: {}, lastError: errorMessage(err) });
  }
}
