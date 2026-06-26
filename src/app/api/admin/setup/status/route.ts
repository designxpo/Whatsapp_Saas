import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { getSetupChecklist } from "@/lib/setupstatus";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // live Meta verification calls

// GET — the per-tenant, PLAN-AWARE setup checklist (only the channels/tools the
// plan grants), with WhatsApp/Instagram/Messenger verified live.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { steps, plan } = await getSetupChecklist(tid);
    return NextResponse.json({ steps, plan });
  } catch (err) {
    return NextResponse.json({ steps: [], error: errorMessage(err) }, { status: 500 });
  }
}
