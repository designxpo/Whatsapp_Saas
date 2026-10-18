import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { crmPushHealth, retryHeldCrmSessions } from "@/lib/leadsquared";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — is chat data actually reaching LeadSquared right now?
//
// Deliberately separate from /api/admin/system/status, which calls verifyLsq()
// and so makes an HTTP round trip to LeadSquared on every request. That is fine
// for a settings page opened occasionally and far too heavy for the Live Chat
// status bar, which polls while someone works the inbox. This reads counters only.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    return NextResponse.json(await crmPushHealth(tid));
  } catch (err) {
    // The bar must never be the reason the inbox looks broken — report the
    // failure as its own state rather than a 500 the UI has to special-case.
    return NextResponse.json({
      configured: true, state: "failing", pending: 0, dead: 0, held: 0,
      lastOkAt: null, lastError: errorMessage(err),
      detail: `Couldn't read the sync status — ${errorMessage(err)}`,
    });
  }
}

// POST { action: "retry" } — release every held conversation for immediate retry.
//
// The recovery step after fixing the CRM side. A permanent rejection parks held
// rows 24 hours out, so without this the backlog trickles back over a day even
// though the problem is already fixed.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.action !== "retry") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    const { released } = await retryHeldCrmSessions(tid);
    return NextResponse.json({ success: true, released, health: await crmPushHealth(tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
