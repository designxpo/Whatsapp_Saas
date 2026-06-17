import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { lsqConfigured, fetchLeadDetails } from "@/lib/leadsquared";

export const dynamic = "force-dynamic";

// GET ?phone= — the lead's LeadSquared CRM snapshot (stage, owner, score, source).
// Returns { configured, lead }. lead is null when LSQ is off or the number isn't in the CRM.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const digits = (new URL(req.url).searchParams.get("phone") ?? "").replace(/\D/g, "");
  if (!digits) return NextResponse.json({ error: "phone required" }, { status: 400 });
  if (!lsqConfigured()) return NextResponse.json({ configured: false, lead: null });
  const lead = await fetchLeadDetails(digits);
  return NextResponse.json({ configured: true, lead });
}
