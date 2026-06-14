import { NextResponse } from "next/server";
import { requireAdmin, requireRoleAdmin, currentUser } from "@/lib/auth";
import { listAdRules, saveAdRule, deleteAdRule, type AdRule } from "@/lib/adrules";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ rules: await listAdRules() });
}

// POST { id?, name, active?, scopeCampaignId?, metric, op, threshold, windowPreset, action }
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string; name?: string; active?: boolean; scopeCampaignId?: string | null; metric?: AdRule["metric"]; op?: AdRule["op"]; threshold?: number; windowPreset?: AdRule["windowPreset"]; action?: AdRule["action"] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.metric || typeof body.threshold !== "number") return NextResponse.json({ error: "name, metric, threshold required" }, { status: 400 });
  try {
    await saveAdRule({
      id: body.id, name: body.name, active: body.active,
      scopeCampaignId: body.scopeCampaignId ?? null,
      metric: body.metric, op: body.op ?? "gt", threshold: body.threshold,
      windowPreset: body.windowPreset ?? "today", action: body.action ?? "pause",
    });
    logActivity(await currentUser(), "ads.rule", `${body.name} (${body.metric} ${body.op ?? "gt"} ${body.threshold})`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — is migration 0016_ad_rules.sql applied?` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteAdRule(body.id);
  return NextResponse.json({ success: true });
}
