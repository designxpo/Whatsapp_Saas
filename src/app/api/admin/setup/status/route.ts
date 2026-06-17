import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { getSetupStatus } from "@/lib/setupstatus";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // live Meta verification calls

// GET — the per-tenant setup checklist, WhatsApp/Instagram verified live.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ steps: await getSetupStatus(tid) });
  } catch (err) {
    return NextResponse.json({ steps: [], error: errorMessage(err) }, { status: 500 });
  }
}
