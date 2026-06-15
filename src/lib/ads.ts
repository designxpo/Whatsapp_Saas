// Meta Marketing API — campaign insights and controls for the Ads tab, plus
// Click-to-WhatsApp lead attribution from our own contacts data.
//
// Token: META_ADS_ACCESS_TOKEN when set, else the WhatsApp system-user token
// (regenerate it with ads_management + ads_read added). The ad account id is
// portal-configurable (wa_settings key "ads_account", env fallback).

import { getTenantSetting, setTenantSetting } from "./store";
import { db } from "./supabase";

const GRAPH = "https://graph.facebook.com/v22.0";
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Ad account + page are per-tenant config (wa_settings, tenant-scoped), with an
// env fallback for the default/internal tenant.
export async function getAdsAccountId(tenantId = DEFAULT_TENANT_ID): Promise<string> {
  const saved = await getTenantSetting<{ accountId?: string }>(tenantId, "ads_account", {});
  return (saved.accountId ?? process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "").trim();
}

export async function setAdsAccountId(accountId: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await setTenantSetting(tenantId, "ads_account", { accountId: accountId.replace(/^act_/, "").trim() });
}

function adsToken(): string | undefined {
  return process.env.META_ADS_ACCESS_TOKEN || process.env.META_WA_ACCESS_TOKEN;
}

async function graphGet(path: string, params: Record<string, string> = {}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const token = adsToken();
  if (!token) return { ok: false, error: "No Meta access token configured" };
  const qs = new URLSearchParams(params).toString();
  try {
    const r = await fetch(`${GRAPH}/${path}${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, error: ((d?.error as Record<string, unknown>)?.message as string) || `HTTP ${r.status}` };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function graphPost(path: string, params: Record<string, string>): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const token = adsToken();
  if (!token) return { ok: false, error: "No Meta access token configured" };
  try {
    const r = await fetch(`${GRAPH}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, error: (((d?.error as Record<string, unknown>)?.error_user_msg as string)) || ((d?.error as Record<string, unknown>)?.message as string) || `HTTP ${r.status}` };
    return { ok: true, data: d };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// CTWA ads run from a Facebook Page — portal-configurable, env fallback.
export async function getAdsPageId(tenantId = DEFAULT_TENANT_ID): Promise<string> {
  const saved = await getTenantSetting<{ pageId?: string }>(tenantId, "ads_page", {});
  return (saved.pageId ?? process.env.META_ADS_PAGE_ID ?? "").trim();
}
export async function setAdsPageId(pageId: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await setTenantSetting(tenantId, "ads_page", { pageId: pageId.trim() });
}

export interface AdAccountInfo { name: string; currency: string; status: number }

export interface AdCampaign {
  id: string;
  name: string;
  effectiveStatus: string;       // ACTIVE | PAUSED | ...
  objective: string;
  dailyBudget: number | null;    // major currency units (Meta stores minor)
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversations: number;         // Meta's "messaging conversations started"
}

export type DatePreset = "today" | "last_7d" | "last_30d";

export async function getAdAccount(accountId: string): Promise<{ ok: boolean; account?: AdAccountInfo; error?: string }> {
  const r = await graphGet(`act_${accountId}`, { fields: "name,currency,account_status" });
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  return { ok: true, account: { name: r.data.name as string, currency: r.data.currency as string, status: r.data.account_status as number } };
}

export async function listAdCampaigns(accountId: string, preset: DatePreset): Promise<{ ok: boolean; campaigns: AdCampaign[]; error?: string }> {
  const r = await graphGet(`act_${accountId}/campaigns`, {
    fields: `name,effective_status,objective,daily_budget,insights.date_preset(${preset}){spend,impressions,clicks,ctr,cpc,actions}`,
    limit: "50",
  });
  if (!r.ok || !r.data) return { ok: false, campaigns: [], error: r.error };
  const rows = (r.data.data as Record<string, unknown>[]) ?? [];
  const campaigns = rows.map(c => {
    const ins = ((c.insights as Record<string, unknown>)?.data as Record<string, unknown>[])?.[0] ?? {};
    const actions = (ins.actions as { action_type: string; value: string }[]) ?? [];
    const convs = actions.find(a => a.action_type.includes("messaging_conversation_started"))?.value ?? "0";
    return {
      id: c.id as string,
      name: c.name as string,
      effectiveStatus: (c.effective_status as string) ?? "UNKNOWN",
      objective: ((c.objective as string) ?? "").replace(/^OUTCOME_/, ""),
      dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      spend: Number(ins.spend ?? 0),
      impressions: Number(ins.impressions ?? 0),
      clicks: Number(ins.clicks ?? 0),
      ctr: Number(ins.ctr ?? 0),
      cpc: Number(ins.cpc ?? 0),
      conversations: Number(convs),
    };
  });
  return { ok: true, campaigns };
}

export async function setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED"): Promise<{ ok: boolean; error?: string }> {
  return graphPost(campaignId, { status });
}

export async function setCampaignDailyBudget(campaignId: string, dailyBudgetMajor: number): Promise<{ ok: boolean; error?: string }> {
  return graphPost(campaignId, { daily_budget: String(Math.round(dailyBudgetMajor * 100)) });
}

// Campaigns, ad sets, and ads all accept the same field updates — one helper.
export async function renameNode(nodeId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  return graphPost(nodeId, { name });
}

export async function duplicateCampaign(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  return graphPost(`${campaignId}/copies`, { deep_copy: "true", status_option: "PAUSED" });
}

// ── Drill-down: ad sets and ads inside a campaign ─────────────────────────────
function insightsOf(row: Record<string, unknown>) {
  const ins = ((row.insights as Record<string, unknown>)?.data as Record<string, unknown>[])?.[0] ?? {};
  const actions = (ins.actions as { action_type: string; value: string }[]) ?? [];
  const convs = actions.find(a => a.action_type.includes("messaging_conversation_started"))?.value ?? "0";
  return {
    spend: Number(ins.spend ?? 0), impressions: Number(ins.impressions ?? 0),
    clicks: Number(ins.clicks ?? 0), ctr: Number(ins.ctr ?? 0), cpc: Number(ins.cpc ?? 0),
    conversations: Number(convs),
  };
}

export interface AdSetRow { id: string; name: string; effectiveStatus: string; dailyBudget: number | null; optimizationGoal: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }
export interface AdRow { id: string; name: string; effectiveStatus: string; thumbnailUrl: string | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }

export async function listAdSets(campaignId: string, preset: DatePreset): Promise<{ ok: boolean; adsets: AdSetRow[]; error?: string }> {
  const r = await graphGet(`${campaignId}/adsets`, {
    fields: `name,effective_status,daily_budget,optimization_goal,insights.date_preset(${preset}){spend,impressions,clicks,ctr,cpc,actions}`,
    limit: "50",
  });
  if (!r.ok || !r.data) return { ok: false, adsets: [], error: r.error };
  return {
    ok: true,
    adsets: ((r.data.data as Record<string, unknown>[]) ?? []).map(a => ({
      id: a.id as string, name: a.name as string, effectiveStatus: (a.effective_status as string) ?? "UNKNOWN",
      dailyBudget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
      optimizationGoal: ((a.optimization_goal as string) ?? "").replace(/_/g, " ").toLowerCase(),
      ...insightsOf(a),
    })),
  };
}

export async function listAds(campaignId: string, preset: DatePreset): Promise<{ ok: boolean; ads: AdRow[]; error?: string }> {
  const r = await graphGet(`${campaignId}/ads`, {
    fields: `name,effective_status,creative{thumbnail_url},insights.date_preset(${preset}){spend,impressions,clicks,ctr,cpc,actions}`,
    limit: "100",
  });
  if (!r.ok || !r.data) return { ok: false, ads: [], error: r.error };
  return {
    ok: true,
    ads: ((r.data.data as Record<string, unknown>[]) ?? []).map(a => ({
      id: a.id as string, name: a.name as string, effectiveStatus: (a.effective_status as string) ?? "UNKNOWN",
      thumbnailUrl: ((a.creative as Record<string, unknown>)?.thumbnail_url as string) ?? null,
      ...insightsOf(a),
    })),
  };
}

// ── Full single-node analytics (campaign / ad set / ad detail view) ───────────
export interface NodeInsights {
  id: string;
  name: string;
  effectiveStatus: string;
  level: "campaign" | "adset" | "ad";
  objective: string | null;
  dailyBudget: number | null;
  thumbnailUrl: string | null;
  dateStart: string | null;
  dateStop: string | null;
  // core delivery
  spend: number; impressions: number; reach: number; frequency: number;
  // clicks
  clicks: number; uniqueClicks: number; linkClicks: number; ctr: number; cpc: number; cpm: number; cpp: number;
  // messaging
  conversations: number; costPerConversation: number | null;
  // full action + cost breakdowns (everything Meta reports)
  actions: { type: string; value: number }[];
  costPerAction: { type: string; value: number }[];
}

const INSIGHT_FIELDS = "spend,impressions,reach,frequency,clicks,unique_clicks,inline_link_clicks,ctr,cpc,cpm,cpp,actions,cost_per_action_type,date_start,date_stop";

function num(v: unknown): number { return Number(v ?? 0) || 0; }

export async function getNodeInsights(nodeId: string, level: NodeInsights["level"], preset: DatePreset): Promise<{ ok: boolean; node?: NodeInsights; error?: string }> {
  const extra = level === "campaign" ? ",objective,daily_budget" : level === "adset" ? ",daily_budget,optimization_goal" : ",creative{thumbnail_url}";
  const r = await graphGet(nodeId, { fields: `name,effective_status${extra},insights.date_preset(${preset}){${INSIGHT_FIELDS}}` });
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  const d = r.data;
  const ins = ((d.insights as Record<string, unknown>)?.data as Record<string, unknown>[])?.[0] ?? {};
  const actions = ((ins.actions as { action_type: string; value: string }[]) ?? []).map(a => ({ type: a.action_type, value: num(a.value) }));
  const costs = ((ins.cost_per_action_type as { action_type: string; value: string }[]) ?? []).map(a => ({ type: a.action_type, value: num(a.value) }));
  const conv = actions.find(a => a.type.includes("messaging_conversation_started"))?.value ?? 0;
  const costConv = costs.find(a => a.type.includes("messaging_conversation_started"))?.value ?? null;
  return {
    ok: true,
    node: {
      id: nodeId,
      name: (d.name as string) ?? "",
      effectiveStatus: (d.effective_status as string) ?? "UNKNOWN",
      level,
      objective: ((d.objective as string) ?? "").replace(/^OUTCOME_/, "") || null,
      dailyBudget: d.daily_budget ? num(d.daily_budget) / 100 : null,
      thumbnailUrl: ((d.creative as Record<string, unknown>)?.thumbnail_url as string) ?? null,
      dateStart: (ins.date_start as string) ?? null,
      dateStop: (ins.date_stop as string) ?? null,
      spend: num(ins.spend), impressions: num(ins.impressions), reach: num(ins.reach), frequency: num(ins.frequency),
      clicks: num(ins.clicks), uniqueClicks: num(ins.unique_clicks), linkClicks: num(ins.inline_link_clicks),
      ctr: num(ins.ctr), cpc: num(ins.cpc), cpm: num(ins.cpm), cpp: num(ins.cpp),
      conversations: conv, costPerConversation: costConv,
      actions, costPerAction: costs,
    },
  };
}

// Children cards for a detail view: a campaign shows its ad sets + ads; an ad
// set shows its ads. Meta's /{id}/ads edge works for both campaign and ad set.
export async function getNodeChildren(level: NodeInsights["level"], id: string, preset: DatePreset): Promise<{ adsets: AdSetRow[]; ads: AdRow[] }> {
  if (level === "campaign") {
    const [s, a] = await Promise.all([listAdSets(id, preset), listAds(id, preset)]);
    return { adsets: s.adsets, ads: a.ads };
  }
  if (level === "adset") {
    const a = await listAds(id, preset);
    return { adsets: [], ads: a.ads };
  }
  return { adsets: [], ads: [] };
}

// Maps ad id → campaign id, for attributing our CTWA leads to campaigns.
export async function adCampaignIndex(accountId: string): Promise<Map<string, string>> {
  const r = await graphGet(`act_${accountId}/ads`, { fields: "campaign_id", limit: "500" });
  const map = new Map<string, string>();
  for (const a of ((r.data?.data as Record<string, unknown>[]) ?? [])) map.set(a.id as string, a.campaign_id as string);
  return map;
}

// ── Targeting search (live, as the user types in the wizard) ──────────────────
export async function searchTargeting(kind: "geo" | "interest" | "locale", q: string): Promise<{ key: string; name: string; type?: string; audience?: number; context?: string }[]> {
  const params: Record<string, string> =
    kind === "geo" ? { type: "adgeolocation", q, location_types: JSON.stringify(["country", "region", "geo_market", "city", "subcity", "neighborhood", "metro_area", "zip"]), limit: "15" }
    : kind === "locale" ? { type: "adlocale", q, limit: "8" }
    : { type: "adinterest", q, limit: "8" };
  const r = await graphGet("search", params);
  return (((r.data?.data as Record<string, unknown>[]) ?? [])).map(x => {
    // Parent hierarchy disambiguates same-named areas (e.g. many "Saket"s).
    const ctx = kind === "geo"
      ? [x.region as string, x.country_name as string].filter(Boolean).join(", ")
      : "";
    return {
      key: String(x.key ?? x.id),
      name: x.name as string,
      type: (x.type as string) ?? kind,
      audience: x.audience_size_upper_bound ? Number(x.audience_size_upper_bound) : undefined,
      context: ctx || undefined,
    };
  });
}

// ── Geocode a place/address → coordinates, for pinned-radius targeting. ───────
// Uses OpenStreetMap Nominatim (no key). Powers the map search + custom_locations.
export async function geocodePlaces(q: string): Promise<{ name: string; context: string; lat: number; lng: number; type: string; countryCode?: string }[]> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": "TalkoAI/1.0 (ads geo search)", "Accept-Language": "en" }, cache: "no-store",
    });
    if (!r.ok) return [];
    const rows = (await r.json().catch(() => [])) as Record<string, unknown>[];
    return rows.map(x => {
      const dn = String(x.display_name ?? "");
      const parts = dn.split(",").map(s => s.trim());
      const addr = (x.address as Record<string, unknown>) ?? {};
      return {
        name: parts[0] || dn,
        context: parts.slice(1, 4).join(", "),
        lat: Number(x.lat), lng: Number(x.lon),
        type: String(x.addresstype ?? x.type ?? "place"),
        countryCode: addr.country_code ? String(addr.country_code).toUpperCase() : undefined,
      };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } catch { return []; }
}

// The campaign an ad belongs to — used to resolve campaign-level flow triggers.
export async function getAdCampaignId(adId: string): Promise<string | null> {
  const r = await graphGet(adId, { fields: "campaign_id" });
  return r.ok ? ((r.data?.campaign_id as string) ?? null) : null;
}

// Conversion pixels/datasets on the account — for website-conversion optimisation.
export async function listPixels(accountId: string): Promise<{ id: string; name: string }[]> {
  const r = await graphGet(`act_${accountId}/adspixels`, { fields: "id,name", limit: "50" });
  return (((r.data?.data as Record<string, unknown>[]) ?? [])).map(p => ({ id: p.id as string, name: (p.name as string) || (p.id as string) }));
}

// Existing instant lead forms on the Page — for the lead-form conversion location.
export async function listLeadForms(pageId: string): Promise<{ id: string; name: string; status: string }[]> {
  const r = await graphGet(`${pageId}/leadgen_forms`, { fields: "id,name,status", limit: "100" });
  return (((r.data?.data as Record<string, unknown>[]) ?? [])).map(f => ({ id: f.id as string, name: f.name as string, status: (f.status as string) ?? "" }));
}

// Saved/custom audiences on the account — for include/exclude (retargeting & suppression).
export async function listCustomAudiences(accountId: string): Promise<{ id: string; name: string; count: number | null }[]> {
  const r = await graphGet(`act_${accountId}/customaudiences`, { fields: "id,name,approximate_count_lower_bound", limit: "100" });
  return (((r.data?.data as Record<string, unknown>[]) ?? [])).map(a => ({
    id: a.id as string, name: a.name as string,
    count: a.approximate_count_lower_bound != null ? Number(a.approximate_count_lower_bound) : null,
  }));
}

// ── Image upload → image_hash for creatives ───────────────────────────────────
export async function uploadAdImage(accountId: string, bytes: ArrayBuffer, filename: string): Promise<{ ok: boolean; hash?: string; error?: string }> {
  const token = adsToken();
  if (!token) return { ok: false, error: "No Meta access token configured" };
  try {
    const fd = new FormData();
    fd.append("source", new Blob([bytes]), filename || "ad.jpg");
    const r = await fetch(`${GRAPH}/act_${accountId}/adimages`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, error: ((d?.error as Record<string, unknown>)?.message as string) || `HTTP ${r.status}` };
    const images = d.images as Record<string, { hash: string }> | undefined;
    const hash = images ? Object.values(images)[0]?.hash : undefined;
    return hash ? { ok: true, hash } : { ok: false, error: "Upload returned no image hash" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Resolve uploaded image hashes back to Meta-hosted URLs (for draft previews).
export async function getAdImageUrls(accountId: string, hashes: string[]): Promise<Record<string, string>> {
  const clean = hashes.filter(Boolean);
  if (!clean.length) return {};
  const r = await graphGet(`act_${accountId}/adimages`, { hashes: JSON.stringify(clean), fields: "hash,url,permalink_url" });
  const out: Record<string, string> = {};
  for (const img of ((r.data?.data as Record<string, unknown>[]) ?? [])) {
    const h = img.hash as string; const u = (img.url ?? img.permalink_url) as string | undefined;
    if (h && u) out[h] = u;
  }
  return out;
}

// Resolve an uploaded video to its thumbnail (for draft previews).
export async function getAdVideoThumb(videoId: string): Promise<string | null> {
  const r = await graphGet(videoId, { fields: "picture" });
  return r.ok ? ((r.data?.picture as string) ?? null) : null;
}

// ── Video upload → video_id for video creatives ──────────────────────────────
export async function uploadAdVideo(accountId: string, bytes: ArrayBuffer, filename: string): Promise<{ ok: boolean; videoId?: string; error?: string }> {
  const token = adsToken();
  if (!token) return { ok: false, error: "No Meta access token configured" };
  try {
    const fd = new FormData();
    fd.append("source", new Blob([bytes]), filename || "ad.mp4");
    const r = await fetch(`${GRAPH}/act_${accountId}/advideos`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, error: ((d?.error as Record<string, unknown>)?.message as string) || `HTTP ${r.status}` };
    return d.id ? { ok: true, videoId: d.id as string } : { ok: false, error: "Upload returned no video id" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Ad preview (Meta-rendered iframe HTML) ────────────────────────────────────
export async function adPreview(adId: string): Promise<{ ok: boolean; html?: string; error?: string }> {
  const r = await graphGet(`${adId}/previews`, { ad_format: "MOBILE_FEED_STANDARD" });
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  const body = ((r.data.data as Record<string, unknown>[]) ?? [])[0]?.body as string | undefined;
  return body ? { ok: true, html: body } : { ok: false, error: "No preview available" };
}

// ── Create a complete Click-to-WhatsApp campaign ──────────────────────────────
// campaign → ad set (WhatsApp destination, targeting) → creative → ad.
// Created PAUSED unless activate=true, so nothing spends by accident.
export type AdObjective = "OUTCOME_ENGAGEMENT" | "OUTCOME_TRAFFIC" | "OUTCOME_SALES" | "OUTCOME_LEADS" | "OUTCOME_AWARENESS";
export type BidStrategy = "LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "LOWEST_COST_WITH_BID_CAP";

// Optimization goal that pairs safely with a WhatsApp-destination ad set, by objective.
const OBJECTIVE_OPT_GOAL: Record<AdObjective, string> = {
  OUTCOME_ENGAGEMENT: "CONVERSATIONS",
  OUTCOME_SALES: "CONVERSATIONS",
  OUTCOME_LEADS: "CONVERSATIONS",
  OUTCOME_TRAFFIC: "LINK_CLICKS",
  OUTCOME_AWARENESS: "REACH",
};

export interface CtwaInput {
  accountId: string;
  pageId: string;
  name: string;
  objective: AdObjective;
  specialAdCategories: string[];       // [] | ["CREDIT"] | ["EMPLOYMENT"] | ["HOUSING"] | ["ISSUES_ELECTIONS_POLITICS"] | ["FINANCIAL_PRODUCTS_SERVICES"]
  conversionLocation: "WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM";
  websiteUrl?: string | null;          // WEBSITE: landing page
  pixelId?: string | null;             // WEBSITE: optimise for a pixel conversion
  conversionEvent?: string | null;     // WEBSITE: e.g. LEAD, PURCHASE, COMPLETE_REGISTRATION
  leadFormId?: string | null;          // INSTANT_FORM: existing lead form id
  ctaType?: string | null;             // WEBSITE: LEARN_MORE, SIGN_UP, …
  budgetLevel: "campaign" | "adset";   // CBO (campaign) vs ABO (ad set)
  budgetType: "daily" | "lifetime";
  budget: number;                      // major units (e.g. ₹500)
  startTime?: string | null;           // optional schedule start (ISO)
  endTime?: string | null;             // required for lifetime (ISO)
  bidStrategy: BidStrategy;
  bidAmount?: number | null;           // major units — for COST_CAP / bid cap
  optimizationGoal?: string;           // performance goal override (else recommended per destination)
  placements: "advantage" | "manual";
  publisherPlatforms: string[];        // manual only: facebook, instagram, messenger, audience_network
  positions?: Record<string, string[]>;// manual only: per-platform positions, e.g. { facebook: ["feed","facebook_reels"], instagram: ["stream","story","reels"] }
  targeting: {
    countries: string[];
    cities: { key: string; name?: string; radius?: number }[];   // radius in km (Meta: 17–80)
    regions: { key: string; name?: string }[];
    zips?: { key: string }[];                                    // postal codes
    neighborhoods?: { key: string }[];                           // local areas (e.g. Hauz Khas)
    subcities?: { key: string }[];                               // districts within a city
    metros?: { key: string }[];                                  // metro areas / DMA
    geoMarkets?: { key: string }[];                              // designated market areas
    customLocations?: { lat: number; lng: number; radius?: number; name?: string }[]; // pinned radius (any point)
    ageMin: number; ageMax: number;
    genders: number[];                 // [] = all, [1]=men, [2]=women
    interests: { id: string; name: string }[];
    locales: number[];                 // language ids ([] = all)
    customAudiences: { id: string }[];        // include (retargeting)
    excludedCustomAudiences: { id: string }[];// exclude (suppression)
    advantageAudience: boolean;        // let Meta expand beyond the defined audience
  };
  creative: {
    format?: "single" | "video" | "carousel";
    imageHash?: string | null;          // single + video thumbnail
    videoId?: string | null;            // video
    cards?: { imageHash?: string | null; headline: string; description?: string; link?: string }[]; // carousel (≥2)
    primaryText: string; headline: string; description?: string; urlTags?: string;
  };
  activate: boolean;
}

// Build the Meta targeting_spec from our targeting + placement inputs.
// Shared by campaign creation and the audience-size estimate.
type TargetingInput = Pick<CtwaInput, "targeting" | "placements" | "publisherPlatforms" | "positions">;
function buildTargetingSpec(input: TargetingInput): Record<string, unknown> {
  const t = input.targeting;
  const geo: Record<string, unknown> = {};
  if (t.countries?.length) geo.countries = t.countries;
  if (t.cities?.length) geo.cities = t.cities.map(c => c.radius
    ? { key: c.key, radius: Math.min(80, Math.max(17, Math.round(c.radius))), distance_unit: "kilometer" }
    : { key: c.key });
  if (t.regions?.length) geo.regions = t.regions.map(r => ({ key: r.key }));
  if (t.zips?.length) geo.zips = t.zips.map(z => ({ key: z.key }));
  if (t.neighborhoods?.length) geo.neighborhoods = t.neighborhoods.map(n => ({ key: n.key }));
  if (t.subcities?.length) geo.subcities = t.subcities.map(s => ({ key: s.key }));
  if (t.metros?.length) geo.metro_areas = t.metros.map(m => ({ key: m.key }));
  if (t.geoMarkets?.length) geo.geo_markets = t.geoMarkets.map(g => ({ key: g.key }));
  if (t.customLocations?.length) geo.custom_locations = t.customLocations.map(c => ({
    latitude: c.lat, longitude: c.lng,
    radius: Math.min(80, Math.max(1, Math.round(c.radius ?? 10))), distance_unit: "kilometer",
    ...(c.name ? { address_string: c.name } : {}),
  }));
  // Include custom audiences → turn off Advantage+ expansion (they conflict).
  const useAdvantage = t.advantageAudience && (t.customAudiences?.length ?? 0) === 0;
  return {
    geo_locations: Object.keys(geo).length ? geo : { countries: ["IN"] },
    age_min: Math.max(18, t.ageMin || 18),
    age_max: Math.min(65, t.ageMax || 65),
    ...(t.genders?.length ? { genders: t.genders } : {}),
    ...(t.interests?.length ? { flexible_spec: [{ interests: t.interests.map(i => ({ id: i.id, name: i.name })) }] } : {}),
    ...(t.locales?.length ? { locales: t.locales } : {}),
    ...(t.customAudiences?.length ? { custom_audiences: t.customAudiences } : {}),
    ...(t.excludedCustomAudiences?.length ? { excluded_custom_audiences: t.excludedCustomAudiences } : {}),
    ...(input.placements === "manual" && input.publisherPlatforms?.length ? {
      publisher_platforms: input.publisherPlatforms,
      // Per-platform positions (Feed/Stories/Reels…) — only for enabled platforms.
      ...(input.positions?.facebook?.length && input.publisherPlatforms.includes("facebook") ? { facebook_positions: input.positions.facebook } : {}),
      ...(input.positions?.instagram?.length && input.publisherPlatforms.includes("instagram") ? { instagram_positions: input.positions.instagram } : {}),
      ...(input.positions?.messenger?.length && input.publisherPlatforms.includes("messenger") ? { messenger_positions: input.positions.messenger } : {}),
      ...(input.positions?.audience_network?.length && input.publisherPlatforms.includes("audience_network") ? { audience_network_positions: input.positions.audience_network } : {}),
    } : {}),
    targeting_automation: { advantage_audience: useAdvantage ? 1 : 0 },
  };
}

// ── Audience size estimate — Meta's delivery_estimate from a targeting spec. ──
export type AudienceEstimateInput = TargetingInput & { accountId: string } & Pick<CtwaInput, "conversionLocation" | "websiteUrl" | "pixelId" | "conversionEvent" | "leadFormId" | "ctaType" | "pageId" | "objective" | "optimizationGoal">;
export async function estimateAudience(input: AudienceEstimateInput): Promise<{ ok: boolean; lower?: number; upper?: number; ready?: boolean; error?: string }> {
  const targetingSpec = buildTargetingSpec(input);
  const { optimizationGoal } = resolveCtwaDestination(input);
  const r = await graphGet(`act_${input.accountId}/delivery_estimate`, {
    optimization_goal: optimizationGoal,
    targeting_spec: JSON.stringify(targetingSpec),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const row = ((r.data?.data as Record<string, unknown>[]) ?? [])[0] ?? (r.data as Record<string, unknown>);
  const lower = (row?.estimate_mau_lower_bound ?? row?.estimate_mau ?? row?.estimate_dau) as number | undefined;
  const upper = (row?.estimate_mau_upper_bound ?? row?.estimate_mau ?? row?.estimate_dau) as number | undefined;
  if (lower == null && upper == null) return { ok: false, error: "No estimate available for this targeting." };
  return { ok: true, lower, upper, ready: (row?.estimate_ready as boolean) ?? true };
}

// Conversion location → ad-set destination + the creative's link & call-to-action.
// Shared by campaign creation and live preview so both render identically.
type DestinationInput = Pick<CtwaInput, "conversionLocation" | "websiteUrl" | "pixelId" | "conversionEvent" | "leadFormId" | "ctaType" | "pageId" | "objective" | "optimizationGoal">;
function resolveCtwaDestination(input: DestinationInput): {
  link: string; callToAction: Record<string, unknown>;
  destinationType: string | null; optimizationGoal: string; promotedObject: Record<string, unknown> | null;
} {
  const loc = input.conversionLocation;
  let optimizationGoal = OBJECTIVE_OPT_GOAL[input.objective];
  let destinationType: string | null = null;
  let promotedObject: Record<string, unknown> | null = { page_id: input.pageId };
  let link = "https://api.whatsapp.com/send";
  let callToAction: Record<string, unknown> = { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };

  if (loc === "WHATSAPP") {
    destinationType = "WHATSAPP"; optimizationGoal = "CONVERSATIONS";
  } else if (loc === "MESSENGER") {
    destinationType = "MESSENGER"; optimizationGoal = "CONVERSATIONS";
    callToAction = { type: "MESSAGE_PAGE", value: { app_destination: "MESSENGER" } };
  } else if (loc === "WEBSITE") {
    destinationType = null; link = input.websiteUrl || "https://www.example.com";
    callToAction = { type: input.ctaType || "LEARN_MORE", value: { link } };
    if (input.pixelId && input.conversionEvent) {
      optimizationGoal = "OFFSITE_CONVERSIONS";
      promotedObject = { pixel_id: input.pixelId, custom_event_type: input.conversionEvent };
    } else {
      optimizationGoal = "LANDING_PAGE_VIEWS"; promotedObject = null;
    }
  } else if (loc === "INSTANT_FORM") {
    destinationType = "ON_AD"; optimizationGoal = "LEAD_GENERATION";
    link = input.websiteUrl || "https://fb.com/";
    callToAction = { type: "SIGN_UP", value: { lead_gen_form_id: input.leadFormId } };
    promotedObject = { page_id: input.pageId };
  }

  // Performance-goal override. Pixel conversions stay tied to the pixel; every
  // other goal (link clicks / reach / impressions / landing-page views) drops
  // the pixel promoted_object so the ad set is valid.
  if (input.optimizationGoal && input.optimizationGoal !== optimizationGoal) {
    optimizationGoal = input.optimizationGoal;
    if (loc === "WEBSITE") {
      promotedObject = (optimizationGoal === "OFFSITE_CONVERSIONS" && input.pixelId && input.conversionEvent)
        ? { pixel_id: input.pixelId, custom_event_type: input.conversionEvent } : null;
    }
  }
  return { link, callToAction, destinationType, optimizationGoal, promotedObject };
}

// Build the object_story_spec for single image / video / carousel creatives.
function buildCreativeStorySpec(pageId: string, c: CtwaInput["creative"], link: string, callToAction: Record<string, unknown>): Record<string, unknown> {
  const format = c.format ?? "single";
  if (format === "video" && c.videoId) {
    return {
      page_id: pageId,
      video_data: {
        video_id: c.videoId,
        message: c.primaryText,
        title: c.headline,
        ...(c.description ? { link_description: c.description } : {}),
        ...(c.imageHash ? { image_hash: c.imageHash } : {}),   // thumbnail (else Meta auto-generates)
        call_to_action: callToAction,
      },
    };
  }
  if (format === "carousel" && (c.cards?.length ?? 0) >= 2) {
    return {
      page_id: pageId,
      link_data: {
        message: c.primaryText,
        link,
        child_attachments: c.cards!.map(card => ({
          link: card.link?.trim() || link,
          name: card.headline,
          ...(card.description ? { description: card.description } : {}),
          ...(card.imageHash ? { image_hash: card.imageHash } : {}),
          call_to_action: callToAction,
        })),
        call_to_action: callToAction,
      },
    };
  }
  return {
    page_id: pageId,
    link_data: {
      message: c.primaryText,
      name: c.headline,
      ...(c.description ? { description: c.description } : {}),
      ...(c.imageHash ? { image_hash: c.imageHash } : {}),
      link,
      call_to_action: callToAction,
    },
  };
}

// ── Live previews — Meta-rendered iframes for the real placements, from a
// creative spec, WITHOUT creating an ad (act_<id>/generatepreviews). ──────────
export const PREVIEW_FORMATS: { key: string; label: string; adFormat: string }[] = [
  { key: "fb_feed",   label: "Facebook Feed",     adFormat: "MOBILE_FEED_STANDARD" },
  { key: "ig_feed",   label: "Instagram Feed",    adFormat: "INSTAGRAM_STANDARD" },
  { key: "ig_story",  label: "Instagram Story",   adFormat: "INSTAGRAM_STORY" },
  { key: "fb_story",  label: "Facebook Story",    adFormat: "FACEBOOK_STORY_MOBILE" },
  { key: "ig_reels",  label: "Instagram Reels",   adFormat: "INSTAGRAM_REELS" },
  { key: "fb_right",  label: "Facebook Right Col", adFormat: "RIGHT_COLUMN_STANDARD" },
];

export type PreviewInput = DestinationInput & { accountId: string; creative: CtwaInput["creative"] };
export async function generateAdPreviews(input: PreviewInput): Promise<{ ok: boolean; previews?: { key: string; label: string; html: string }[]; error?: string }> {
  const { link, callToAction } = resolveCtwaDestination(input);
  const storySpec = buildCreativeStorySpec(input.pageId, input.creative, link, callToAction);
  const creativeParam = JSON.stringify({
    object_story_spec: storySpec,
    ...(input.creative.urlTags ? { url_tags: input.creative.urlTags } : {}),
  });
  const results = await Promise.all(PREVIEW_FORMATS.map(async f => {
    const r = await graphPost(`act_${input.accountId}/generatepreviews`, { creative: creativeParam, ad_format: f.adFormat });
    const body = ((r.data?.data as Record<string, unknown>[]) ?? [])[0]?.body as string | undefined;
    return { key: f.key, label: f.label, html: body ?? null };
  }));
  const previews = results.filter((r): r is { key: string; label: string; html: string } => !!r.html);
  if (!previews.length) return { ok: false, error: "Meta returned no previews — check the creative (image/video uploaded?) and Page ID." };
  return { ok: true, previews };
}

export async function createCtwaCampaign(input: CtwaInput): Promise<{ ok: boolean; campaignId?: string; adId?: string; error?: string; stage?: string }> {
  const status = input.activate ? "ACTIVE" : "PAUSED";
  const minor = (major: number) => String(Math.round(major * 100));
  const budgetField = input.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget";
  const cbo = input.budgetLevel === "campaign";

  // Campaign — holds the budget + bid strategy under CBO (Advantage campaign budget).
  const campParams: Record<string, string> = {
    name: input.name, objective: input.objective, status,
    special_ad_categories: JSON.stringify(input.specialAdCategories ?? []), buying_type: "AUCTION",
  };
  if (cbo) {
    campParams[budgetField] = minor(input.budget);
    campParams.bid_strategy = input.bidStrategy;
  }
  const camp = await graphPost(`act_${input.accountId}/campaigns`, campParams);
  if (!camp.ok) return { ok: false, error: camp.error, stage: "campaign" };
  const campaignId = camp.data?.id as string;

  const targeting = buildTargetingSpec(input);

  // Conversion location drives destination, optimization, promoted object,
  // and the creative's link + call-to-action.
  const { link, callToAction, destinationType, optimizationGoal, promotedObject } = resolveCtwaDestination(input);

  const adsetParams: Record<string, string> = {
    name: `${input.name} — ad set`, campaign_id: campaignId, status,
    billing_event: "IMPRESSIONS",
    optimization_goal: optimizationGoal,
    ...(destinationType ? { destination_type: destinationType } : {}),
    ...(promotedObject ? { promoted_object: JSON.stringify(promotedObject) } : {}),
    targeting: JSON.stringify(targeting),
  };
  if (!cbo) {                                   // ABO — budget + strategy on the ad set
    adsetParams[budgetField] = minor(input.budget);
    adsetParams.bid_strategy = input.bidStrategy;
  }
  if (input.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && input.bidAmount) adsetParams.bid_amount = minor(input.bidAmount);
  if (input.budgetType === "lifetime") {
    adsetParams.start_time = input.startTime || new Date().toISOString();
    if (input.endTime) adsetParams.end_time = input.endTime;
  } else {                                      // daily — optional schedule
    if (input.startTime) adsetParams.start_time = input.startTime;
    if (input.endTime) adsetParams.end_time = input.endTime;
  }
  const adset = await graphPost(`act_${input.accountId}/adsets`, adsetParams);
  if (!adset.ok) return { ok: false, campaignId, error: adset.error, stage: "ad set" };

  // Creative spec — single image, video, or carousel (shared with live preview).
  const storySpec = buildCreativeStorySpec(input.pageId, input.creative, link, callToAction);
  const creative = await graphPost(`act_${input.accountId}/adcreatives`, {
    name: `${input.name} — creative`,
    ...(input.creative.urlTags ? { url_tags: input.creative.urlTags } : {}),
    object_story_spec: JSON.stringify(storySpec),
  });
  if (!creative.ok) return { ok: false, campaignId, error: creative.error, stage: "creative" };

  const ad = await graphPost(`act_${input.accountId}/ads`, {
    name: `${input.name} — ad`, adset_id: adset.data?.id as string, status,
    creative: JSON.stringify({ creative_id: creative.data?.id as string }),
  });
  if (!ad.ok) return { ok: false, campaignId, error: ad.error, stage: "ad" };

  return { ok: true, campaignId, adId: ad.data?.id as string };
}

// ── CTWA attribution from our own data ────────────────────────────────────────
// The webhook stamps contacts arriving from a Click-to-WhatsApp ad with
// ad_id / ad_headline attributes. A "lead" = the contact went on to share at
// least one real detail (email or any non-ad attribute via AI/flows/forms).
export interface AdAttribution { adId: string; headline: string; contacts: number; leads: number }

export async function adAttribution(tenantId = DEFAULT_TENANT_ID): Promise<AdAttribution[]> {
  const { data } = await db().from("contacts")
    .select("email, attributes")
    .eq("tenant_id", tenantId)
    .not("attributes->>ad_id", "is", null)
    .limit(5000);
  const byAd = new Map<string, AdAttribution>();
  for (const row of (data ?? []) as { email: string | null; attributes: Record<string, string> | null }[]) {
    const attrs = row.attributes ?? {};
    const adId = attrs.ad_id;
    if (!adId) continue;
    const entry = byAd.get(adId) ?? { adId, headline: attrs.ad_headline || `Ad ${adId}`, contacts: 0, leads: 0 };
    entry.contacts++;
    const hasDetails = !!row.email || Object.keys(attrs).some(k => !k.startsWith("ad_"));
    if (hasDetails) entry.leads++;
    byAd.set(adId, entry);
  }
  return [...byAd.values()].sort((a, b) => b.contacts - a.contacts);
}
