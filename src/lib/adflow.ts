import { DEFAULT_TENANT_ID } from "./tenant";
// ── Ad → Flow triggers ────────────────────────────────────────────────────────
// Bind a chatbot flow to a Meta Ads campaign (default) or a specific ad (override).
// When a Click-to-WhatsApp lead first messages, the webhook resolves which flow to
// auto-start from the ad they came from — ad-level binding wins over campaign-level.
import { db } from "@/lib/supabase";
import { getAdCampaignId } from "@/lib/ads";


export type FlowTriggerScope = "ad" | "campaign";
export interface FlowTrigger { id: string; flowId: string; scope: FlowTriggerScope; refId: string; label: string | null; createdAt: string }

function mapRow(r: Record<string, unknown>): FlowTrigger {
  return { id: r.id as string, flowId: r.flow_id as string, scope: r.scope as FlowTriggerScope, refId: r.ref_id as string, label: (r.label as string) ?? null, createdAt: r.created_at as string };
}

// All triggers bound to one flow (for the flow editor).
export async function listFlowTriggers(flowId: string): Promise<FlowTrigger[]> {
  const { data } = await db().from("wa_ad_flow_triggers").select("*").eq("flow_id", flowId).order("created_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

// Bind (or rebind) a campaign/ad to a flow. One flow per (scope, ref_id).
export async function setFlowTrigger(p: { flowId: string; scope: FlowTriggerScope; refId: string; label?: string | null; tenantId?: string }): Promise<void> {
  await db().from("wa_ad_flow_triggers").upsert(
    { tenant_id: p.tenantId ?? DEFAULT_TENANT_ID, flow_id: p.flowId, scope: p.scope, ref_id: p.refId, label: p.label ?? null },
    { onConflict: "tenant_id,scope,ref_id" },
  );
}

export async function removeFlowTrigger(scope: FlowTriggerScope, refId: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_ad_flow_triggers").delete().eq("tenant_id", tenantId).eq("scope", scope).eq("ref_id", refId);
}

// ad_id → campaign_id, cached so we don't hit Meta on every inbound message.
async function campaignForAd(adId: string, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const { data } = await db().from("wa_ad_campaign_map").select("campaign_id").eq("tenant_id", tenantId).eq("ad_id", adId).maybeSingle();
  if (data?.campaign_id) return data.campaign_id as string;
  const campaignId = await getAdCampaignId(adId).catch(() => null);
  if (campaignId) await db().from("wa_ad_campaign_map").upsert({ tenant_id: tenantId, ad_id: adId, campaign_id: campaignId }).then(() => undefined, () => undefined);
  return campaignId;
}

// Which flow should auto-start for a lead from this ad? Ad-level binding wins;
// otherwise fall back to the ad's campaign-level binding. null = no binding.
export async function resolveFlowIdForAd(adId: string, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const { data: adHit } = await db().from("wa_ad_flow_triggers").select("flow_id").eq("tenant_id", tenantId).eq("scope", "ad").eq("ref_id", adId).maybeSingle();
  if (adHit?.flow_id) return adHit.flow_id as string;
  const campaignId = await campaignForAd(adId, tenantId);
  if (!campaignId) return null;
  const { data: campHit } = await db().from("wa_ad_flow_triggers").select("flow_id").eq("tenant_id", tenantId).eq("scope", "campaign").eq("ref_id", campaignId).maybeSingle();
  return (campHit?.flow_id as string) ?? null;
}
