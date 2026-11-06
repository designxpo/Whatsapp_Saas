import { NextResponse } from "next/server";
import { currentUser, currentTenantId, noSession } from "@/lib/auth";
import { hotLeads } from "@/lib/hot-leads";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the last three days' leads worth calling, best first, with reasons.
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const tid = await currentTenantId();
    if (!tid) return noSession();
    const leads = await hotLeads(tid);
    return NextResponse.json({ hot: leads.filter(l => l.band === "hot").slice(0, 10), warm: leads.filter(l => l.band === "warm").slice(0, 10) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
