import { DEFAULT_TENANT_ID } from "./tenant";
// ── Ad drafts + portal-campaign tracking ──────────────────────────────────────
// Drafts: auto-saved snapshots of the ad builder so a refresh never loses work
// or accidentally launches an ad. Portal campaigns: which Meta campaigns were
// created from this portal (vs. directly in Ads Manager) — for the dashboard split.
import { tdb } from "@/lib/tenantdb";


export interface AdDraftSummary { id: string; name: string; updatedAt: string }
export interface AdDraft extends AdDraftSummary { data: Record<string, unknown> }

export async function listAdDrafts(tenantId = DEFAULT_TENANT_ID): Promise<AdDraftSummary[]> {
  const { data } = await tdb(tenantId).from("wa_ad_drafts").select("id,name,updated_at").order("updated_at", { ascending: false });
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({ id: r.id as string, name: r.name as string, updatedAt: r.updated_at as string }));
}

export async function getAdDraft(id: string, tenantId = DEFAULT_TENANT_ID): Promise<AdDraft | null> {
  const { data } = await tdb(tenantId).from("wa_ad_drafts").select("id,name,data,updated_at").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return { id: row.id as string, name: row.name as string, data: (row.data as Record<string, unknown>) ?? {}, updatedAt: row.updated_at as string };
}

// Upsert a draft. Without id → create; with id → update in place.
export async function saveAdDraft(p: { id?: string | null; name: string; data: Record<string, unknown> }, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  // tenant_id is stamped by tdb on insert; kept out of `row` so the update path
  // never rewrites it.
  const row = { name: p.name?.slice(0, 200) || "Untitled ad", data: p.data ?? {}, updated_at: new Date().toISOString() };
  if (p.id) {
    await tdb(tenantId).from("wa_ad_drafts").update(row).eq("id", p.id);
    return p.id;
  }
  const { data } = await tdb(tenantId).from("wa_ad_drafts").insert(row).select("id").maybeSingle();
  return (data?.id as string) ?? null;
}

export async function deleteAdDraft(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await tdb(tenantId).from("wa_ad_drafts").delete().eq("id", id);
}

// ── Portal-created campaigns ──────────────────────────────────────────────────
export async function recordPortalCampaign(campaignId: string, name?: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await tdb(tenantId).from("wa_portal_campaigns").upsert({ campaign_id: campaignId, name: name ?? null }).then(() => undefined, () => undefined);
}

export async function listPortalCampaignIds(tenantId = DEFAULT_TENANT_ID): Promise<string[]> {
  const { data } = await tdb(tenantId).from("wa_portal_campaigns").select("campaign_id");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => r.campaign_id as string);
}
