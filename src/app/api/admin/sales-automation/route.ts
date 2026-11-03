import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { getLeadIntelSettings, saveLeadIntelSettings, type LeadIntelSettings } from "@/lib/lead-intel";
import { getApprovalPolicy, saveApprovalPolicy, type ApprovalPolicy } from "@/lib/approvals";
import { lsqConfigured } from "@/lib/leadsquared";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the AI sales-closer settings: lead reads (and which LeadSquared fields
// they fill) and what the AI may ask the team to approve.
export async function GET() {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  try {
    const [leadIntel, approvals, lsq] = await Promise.all([getLeadIntelSettings(g.tid), getApprovalPolicy(g.tid), lsqConfigured(g.tid).catch(() => false)]);
    return NextResponse.json({ leadIntel, approvals, lsqConnected: lsq });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { leadIntel?, approvals? } — admins.
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({})) as { leadIntel?: Partial<LeadIntelSettings>; approvals?: Partial<ApprovalPolicy> };
  try {
    let leadIntel = await getLeadIntelSettings(g.tid);
    if (body.leadIntel) {
      const r = await saveLeadIntelSettings(g.tid, body.leadIntel);
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      leadIntel = r.settings!;
    }
    const approvals = body.approvals ? await saveApprovalPolicy(g.tid, body.approvals) : await getApprovalPolicy(g.tid);
    return NextResponse.json({ ok: true, leadIntel, approvals });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
