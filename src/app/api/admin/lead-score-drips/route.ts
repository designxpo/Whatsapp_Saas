import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import { getScoreDrips, setScoreDrips, type ScoreDrip } from "@/lib/scoredrips";
import { logActivity } from "@/lib/team";
import { currentTenantId } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getChannel as tenantChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

// Which nurture sequence runs when a counsellor grades a lead in LeadSquared.
//
// Deliberately a separate map from /api/admin/stage-drips rather than one
// combined screen: the business grades on both axes and a lead can move on one
// without moving on the other, so merging them would force a choice that does
// not exist in the CRM.

// GET — the lead-score → sequence map (read by the Sequences tab panel).
export async function GET() {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  return NextResponse.json({ drips: await getScoreDrips(tenantId) });
}

// POST { drips: [{ score, sequenceId }] } — replace the map. Admins only.
export async function POST(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { drips?: ScoreDrip[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.drips)) return NextResponse.json({ error: "drips array required" }, { status: 400 });
  await setScoreDrips(body.drips, tenantId);
  logActivity(await currentUser(), "scoredrips.save", `${body.drips.length} rule(s)`);
  return NextResponse.json({ drips: await getScoreDrips(tenantId) });
}
