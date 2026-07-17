import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId } from "@/lib/auth";
import { getStageDrips, setStageDrips, type StageDrip } from "@/lib/stagedrips";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET — the workspace's LSQ-stage → sequence map (read by the Sequences tab panel).
export async function GET() {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ drips: await getStageDrips(tid) });
}

// POST { drips: [{ stage, sequenceId }] } — replace the map. Admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { drips?: StageDrip[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.drips)) return NextResponse.json({ error: "drips array required" }, { status: 400 });
  await setStageDrips(body.drips, tid);
  logActivity(await currentUser(), "stagedrips.save", `${body.drips.length} rule(s)`);
  return NextResponse.json({ drips: await getStageDrips(tid) });
}
