import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { drainSequences } from "@/lib/sequences";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST — process this tenant's due sequence steps right now (same work the cron
// does), so you can verify a drip without waiting for the scheduler. Admin only.
export async function POST() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    const processed = await drainSequences(200, tid);
    logActivity(await currentUser(), "sequence.run", `processed ${processed} due step(s)`);
    return NextResponse.json({ processed });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
