import { NextResponse } from "next/server";
import { requireRoleAdmin } from "@/lib/auth";
import { listFlowTriggers, setFlowTrigger, removeFlowTrigger, type FlowTriggerScope } from "@/lib/adflow";
import { getAdsAccountId, listAdCampaigns, listAds } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET ?flowId=  → { triggers, campaigns }   (campaigns to bind this flow to)
// GET ?ads=CAMPAIGN_ID → { ads }            (ads within a campaign, for ad-level)
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const url = new URL(req.url);
  const adsForCampaign = url.searchParams.get("ads");
  if (adsForCampaign) {
    const r = await listAds(adsForCampaign, "last_30d");
    return NextResponse.json({ ads: r.ads.map(a => ({ id: a.id, name: a.name })) });
  }
  const flowId = url.searchParams.get("flowId");
  if (!flowId) return NextResponse.json({ error: "flowId required" }, { status: 400 });
  const accountId = await getAdsAccountId();
  const [triggers, campRes] = await Promise.all([
    listFlowTriggers(flowId),
    accountId ? listAdCampaigns(accountId, "last_30d") : Promise.resolve({ ok: true, campaigns: [] }),
  ]);
  return NextResponse.json({ triggers, campaigns: campRes.campaigns.map(c => ({ id: c.id, name: c.name })) });
}

// POST { flowId, scope, refId, label } → bind a campaign/ad to this flow.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { flowId?: string; scope?: FlowTriggerScope; refId?: string; label?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.flowId || !body.refId || (body.scope !== "ad" && body.scope !== "campaign")) {
    return NextResponse.json({ error: "flowId, scope (ad|campaign) and refId required" }, { status: 400 });
  }
  await setFlowTrigger({ flowId: body.flowId, scope: body.scope, refId: body.refId, label: body.label ?? null });
  return NextResponse.json({ success: true });
}

// DELETE { scope, refId } → unbind.
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { scope?: FlowTriggerScope; refId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.refId || (body.scope !== "ad" && body.scope !== "campaign")) {
    return NextResponse.json({ error: "scope and refId required" }, { status: 400 });
  }
  await removeFlowTrigger(body.scope, body.refId);
  return NextResponse.json({ success: true });
}
