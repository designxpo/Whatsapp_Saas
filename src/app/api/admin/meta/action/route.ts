import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import { setCampaignStatus, setCampaignDailyBudget, renameNode, duplicateCampaign } from "@/lib/ads";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// POST { campaignId, action, dailyBudget?, name? } — campaignId may be any node
// (campaign / ad set / ad): Meta uses the same update API for all three.
// Controls are admin-only — they move real money.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { campaignId?: string; action?: string; dailyBudget?: number; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  let r: { ok: boolean; error?: string };
  if (body.action === "pause") r = await setCampaignStatus(body.campaignId, "PAUSED");
  else if (body.action === "resume") r = await setCampaignStatus(body.campaignId, "ACTIVE");
  else if (body.action === "budget" && typeof body.dailyBudget === "number" && body.dailyBudget > 0) r = await setCampaignDailyBudget(body.campaignId, body.dailyBudget);
  else if (body.action === "rename" && body.name?.trim()) r = await renameNode(body.campaignId, body.name.trim());
  else if (body.action === "duplicate") r = await duplicateCampaign(body.campaignId);
  else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), `ads.${body.action}`, body.campaignId + (body.action === "budget" ? ` → ${body.dailyBudget}/day` : body.action === "rename" ? ` → ${body.name}` : ""));
  return NextResponse.json({ success: true });
}
