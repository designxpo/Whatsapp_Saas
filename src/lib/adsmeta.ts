import { DEFAULT_TENANT_ID } from "./tenant";
// ── Ad drafts + portal-campaign tracking ──────────────────────────────────────
// Drafts: auto-saved snapshots of the ad builder so a refresh never loses work
// or accidentally launches an ad. Portal campaigns: which Meta campaigns were
// created from this portal (vs. directly in Ads Manager) — for the dashboard split.
import { db } from "@/lib/supabase";


export interface AdDraftSummary { id: string; name: string; updatedAt: string }
export interface AdDraft extends AdDraftSummary { data: Record<string, unknown> }

export async function listAdDrafts(tenantId = DEFAULT_TENANT_ID): Promise<AdDraftSummary[]> {
  const { data } = await db().from("wa_ad_drafts").select("id,name,updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({ id: r.id as string, name: r.name as string, updatedAt: r.updated_at as string }));
}

export async function getAdDraft(id: string, tenantId = DEFAULT_TENANT_ID): Promise<AdDraft | null> {
  const { data } = await db().from("wa_ad_drafts").select("id,name,data,updated_at").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) return null;
  return { id: data.id as string, name: data.name as string, data: (data.data as Record<string, unknown>) ?? {}, updatedAt: data.updated_at as string };
}

// Upsert a draft. Without id → create; with id → update in place.
export async function saveAdDraft(p: { id?: string | null; name: string; data: Record<string, unknown> }, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const row = { tenant_id: tenantId, name: p.name?.slice(0, 200) || "Untitled ad", data: p.data ?? {}, updated_at: new Date().toISOString() };
  if (p.id) {
    await db().from("wa_ad_drafts").update(row).eq("tenant_id", tenantId).eq("id", p.id);
    return p.id;
  }
  const { data } = await db().from("wa_ad_drafts").insert(row).select("id").maybeSingle();
  return (data?.id as string) ?? null;
}

export async function deleteAdDraft(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_ad_drafts").delete().eq("tenant_id", tenantId).eq("id", id);
}

// ── Portal-created campaigns ──────────────────────────────────────────────────
export async function recordPortalCampaign(campaignId: string, name?: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_portal_campaigns").upsert({ tenant_id: tenantId, campaign_id: campaignId, name: name ?? null }).then(() => undefined, () => undefined);
}

export async function listPortalCampaignIds(tenantId = DEFAULT_TENANT_ID): Promise<string[]> {
  const { data } = await db().from("wa_portal_campaigns").select("campaign_id").eq("tenant_id", tenantId);
  return ((data ?? []) as Record<string, unknown>[]).map(r => r.campaign_id as string);
}
