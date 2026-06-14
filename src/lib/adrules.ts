// Automated ad rules — evaluated on the cron tick. Each rule compares a metric
// (from Meta insights, or leads/cost-per-lead from OUR CTWA attribution) against
// a threshold and pauses the campaign or records an alert. Everything lands in
// the activity log so the team sees what the guardian did and why.

import { db } from "./supabase";
import { getAdsAccountId, listAdCampaigns, setCampaignStatus, adAttribution, adCampaignIndex, type DatePreset, type AdCampaign } from "./ads";
import { logActivity } from "./team";

export interface AdRule {
  id: string;
  name: string;
  active: boolean;
  scopeCampaignId: string | null;
  metric: "spend" | "cpc" | "ctr" | "clicks" | "conversations" | "leads" | "cost_per_lead";
  op: "gt" | "lt";
  threshold: number;
  windowPreset: DatePreset;
  action: "pause" | "notify";
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  lastResult: string | null;
}

function mapRule(r: Record<string, unknown>): AdRule {
  return {
    id: r.id as string,
    name: r.name as string,
    active: (r.active as boolean) ?? true,
    scopeCampaignId: (r.scope_campaign_id as string | null) ?? null,
    metric: r.metric as AdRule["metric"],
    op: (r.op as AdRule["op"]) ?? "gt",
    threshold: Number(r.threshold),
    windowPreset: (r.window_preset as DatePreset) ?? "today",
    action: (r.action as AdRule["action"]) ?? "pause",
    lastCheckedAt: (r.last_checked_at as string | null) ?? null,
    lastTriggeredAt: (r.last_triggered_at as string | null) ?? null,
    lastResult: (r.last_result as string | null) ?? null,
  };
}

export async function listAdRules(): Promise<AdRule[]> {
  try {
    const { data, error } = await db().from("wa_ad_rules").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRule);
  } catch { return []; }     // migration 0016 not applied → no rules
}

export async function saveAdRule(input: { id?: string; name: string; active?: boolean; scopeCampaignId?: string | null; metric: AdRule["metric"]; op: AdRule["op"]; threshold: number; windowPreset: DatePreset; action: AdRule["action"] }): Promise<void> {
  const row = {
    name: input.name.trim(),
    active: input.active ?? true,
    scope_campaign_id: input.scopeCampaignId ?? null,
    metric: input.metric,
    op: input.op,
    threshold: input.threshold,
    window_preset: input.windowPreset,
    action: input.action,
  };
  const q = input.id
    ? db().from("wa_ad_rules").update(row).eq("id", input.id)
    : db().from("wa_ad_rules").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deleteAdRule(id: string): Promise<void> {
  await db().from("wa_ad_rules").delete().eq("id", id);
}

// Per-campaign lead counts from our attribution (ad_id attrs → campaign).
async function leadsByCampaign(accountId: string): Promise<Map<string, number>> {
  const [attribution, index] = await Promise.all([adAttribution(), adCampaignIndex(accountId)]);
  const map = new Map<string, number>();
  for (const a of attribution) {
    const cid = index.get(a.adId);
    if (cid) map.set(cid, (map.get(cid) ?? 0) + a.leads);
  }
  return map;
}

function metricValue(rule: AdRule, c: AdCampaign, leads: number): number | null {
  switch (rule.metric) {
    case "spend": return c.spend;
    case "cpc": return c.cpc;
    case "ctr": return c.ctr;
    case "clicks": return c.clicks;
    case "conversations": return c.conversations;
    case "leads": return leads;
    case "cost_per_lead": return c.spend > 0 ? (leads > 0 ? c.spend / leads : Number.POSITIVE_INFINITY) : null;
  }
}

const SYSTEM_ACTOR = { email: "ad-rules@system", name: "Ad rules" };

// Evaluates every active rule. Pauses at most a few campaigns per tick; safe to
// call repeatedly — a paused campaign no longer matches the ACTIVE check.
export async function drainAdRules(): Promise<{ checked: number; triggered: number }> {
  const rules = (await listAdRules()).filter(r => r.active);
  if (rules.length === 0) return { checked: 0, triggered: 0 };
  const accountId = await getAdsAccountId();
  if (!accountId) return { checked: 0, triggered: 0 };

  // One insights fetch per distinct window, shared across rules.
  const byWindow = new Map<DatePreset, AdCampaign[]>();
  for (const preset of new Set(rules.map(r => r.windowPreset))) {
    const r = await listAdCampaigns(accountId, preset);
    if (r.ok) byWindow.set(preset, r.campaigns);
  }
  const needsLeads = rules.some(r => r.metric === "leads" || r.metric === "cost_per_lead");
  const leads = needsLeads ? await leadsByCampaign(accountId).catch(() => new Map<string, number>()) : new Map<string, number>();

  let triggered = 0;
  for (const rule of rules) {
    const campaigns = (byWindow.get(rule.windowPreset) ?? [])
      .filter(c => c.effectiveStatus === "ACTIVE")
      .filter(c => !rule.scopeCampaignId || c.id === rule.scopeCampaignId);

    const hits: string[] = [];
    for (const c of campaigns) {
      const v = metricValue(rule, c, leads.get(c.id) ?? 0);
      if (v === null) continue;
      const match = rule.op === "gt" ? v > rule.threshold : v < rule.threshold;
      if (!match) continue;
      const detail = `${c.name}: ${rule.metric} ${v === Number.POSITIVE_INFINITY ? "∞ (spend with 0 leads)" : Math.round(v * 100) / 100} ${rule.op === "gt" ? ">" : "<"} ${rule.threshold}`;
      if (rule.action === "pause") {
        const res = await setCampaignStatus(c.id, "PAUSED");
        if (res.ok) { hits.push(`paused — ${detail}`); logActivity(SYSTEM_ACTOR, "ads.pause", `${rule.name}: ${detail}`); }
      } else {
        hits.push(`alert — ${detail}`);
        logActivity(SYSTEM_ACTOR, "ads.alert", `${rule.name}: ${detail}`);
      }
    }

    const update: Record<string, unknown> = { last_checked_at: new Date().toISOString() };
    if (hits.length) { triggered += hits.length; update.last_triggered_at = new Date().toISOString(); update.last_result = hits.join(" | ").slice(0, 500); }
    await db().from("wa_ad_rules").update(update).eq("id", rule.id);
  }
  return { checked: rules.length, triggered };
}
