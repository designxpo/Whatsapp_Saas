export const maxDuration = 300;
import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { fetchLeads, type LeadCond } from "@/lib/leadsquared";
import { getSequence, enroll } from "@/lib/sequences";
import { optoutSet } from "@/lib/store";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);

// POST { action: "preview" | "enroll", conditions: LeadCond[], sequenceId?, max? }
//   preview → { count, scanned, truncated, sample[] }   (no enrollment)
//   enroll  → pulls matching LeadSquared leads and enrolls them into the drip
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { action?: string; conditions?: LeadCond[]; sequenceId?: string; max?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const conditions = (body.conditions ?? []).filter(c => c?.field?.trim() && c?.value?.trim());
  if (!conditions.length) return NextResponse.json({ error: "Add at least one condition." }, { status: 400 });
  const max = Math.min(Math.max(body.max ?? 2000, 1), 5000);

  const r = await fetchLeads(conditions, max);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });

  if (body.action === "preview") {
    return NextResponse.json({ count: r.leads.length, scanned: r.scanned, truncated: r.truncated, sample: r.leads.slice(0, 5).map(l => l.name || l.phone) });
  }

  if (!body.sequenceId) return NextResponse.json({ error: "sequenceId required" }, { status: 400 });
  const seq = await getSequence(body.sequenceId, tid);
  if (!seq) return NextResponse.json({ error: "Sequence not found" }, { status: 404 });

  const optout = await optoutSet(tid).catch(() => new Set<string>());
  let enrolled = 0, skippedOptout = 0;
  for (const lead of r.leads) {
    if (optout.has(last10(lead.phone))) { skippedOptout++; continue; }
    try { await enroll(seq.id, { phone: lead.phone, platform: seq.platform }, tid); enrolled++; }
    catch { /* skip individual failures */ }
  }
  logActivity(await currentUser(), "lsq.drip", `${enrolled} → ${seq.name}`);
  return NextResponse.json({ success: true, enrolled, skippedOptout, matched: r.leads.length, truncated: r.truncated });
}
