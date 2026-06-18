import { DEFAULT_TENANT_ID } from "./tenant";
import { randomBytes } from "crypto";
import { db } from "./supabase";


// ── Click tracking (AiSensy-style) ───────────────────────────────────────────
// Templates submitted with click tracking get their URL buttons rewritten to
// {SITE}/r/{{1}}. At send time each recipient gets a unique code per tracked
// button; /r/<code> registers the click and redirects to the original URL.
// Everything here degrades gracefully when migration 0011 hasn't been applied.

export interface TrackedUrl { index: number; url: string }

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function genCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

// ── Template meta ─────────────────────────────────────────────────────────────

export async function setTemplateMeta(templateName: string, meta: { clickTracking: boolean; trackedUrls: TrackedUrl[] }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  // PK is composite (tenant_id, template_name) — see 0020.
  await db().from("wa_template_meta").upsert({
    tenant_id: tenantId,
    template_name: templateName,
    click_tracking: meta.clickTracking,
    tracked_urls: meta.trackedUrls,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,template_name" });
}

export async function getTrackedUrls(templateName: string, tenantId = DEFAULT_TENANT_ID): Promise<TrackedUrl[]> {
  try {
    const { data } = await db().from("wa_template_meta")
      .select("click_tracking, tracked_urls").eq("tenant_id", tenantId).eq("template_name", templateName).maybeSingle();
    if (!data?.click_tracking) return [];
    return (data.tracked_urls as TrackedUrl[]) ?? [];
  } catch { return []; }   // table missing → tracking off
}

// ── Link minting + resolution ────────────────────────────────────────────────

// Creates one short code per tracked button for one recipient.
export async function mintLinks(params: { campaignId: string; phone: string; tracked: TrackedUrl[]; tenantId?: string }): Promise<{ index: number; code: string }[]> {
  const rows = params.tracked.map(t => ({
    tenant_id: params.tenantId ?? DEFAULT_TENANT_ID,
    code: genCode(),
    campaign_id: params.campaignId,
    phone: params.phone,
    target_url: t.url,
    button_index: t.index,
  }));
  const { error } = await db().from("wa_links").insert(rows);
  if (error) throw error;
  return rows.map(r => ({ index: r.button_index, code: r.code }));
}

// Registers a click and returns the target URL (null when code is unknown).
export async function registerClick(code: string): Promise<string | null> {
  try {
    const { data, error } = await db().rpc("wa_register_click", { p_code: code });
    if (error) throw error;
    return (data as string | null) ?? null;
  } catch {
    // RPC missing (old DB) — best-effort non-atomic fallback.
    try {
      const { data } = await db().from("wa_links").select("id, target_url, clicks, first_clicked_at").eq("code", code).maybeSingle();
      if (!data) return null;
      await db().from("wa_links").update({
        clicks: ((data.clicks as number) ?? 0) + 1,
        first_clicked_at: (data.first_clicked_at as string | null) ?? new Date().toISOString(),
      }).eq("id", data.id);
      return data.target_url as string;
    } catch { return null; }
  }
}

// ── Campaign stats (clicked / replied / per-day series) ──────────────────────

export interface CampaignDayPoint { date: string; sent: number; delivered: number; read: number; clicked: number }
export interface CampaignClickStats { clicked: number; trackedRecipients: number; ctaUrl: string | null; perDayClicks: Record<string, number> }

export async function campaignClickStats(campaignId: string): Promise<CampaignClickStats> {
  const empty: CampaignClickStats = { clicked: 0, trackedRecipients: 0, ctaUrl: null, perDayClicks: {} };
  try {
    const { data } = await db().from("wa_links")
      .select("phone, target_url, first_clicked_at").eq("campaign_id", campaignId).limit(20000);
    if (!data?.length) return empty;
    const clickedPhones = new Set<string>();
    const allPhones = new Set<string>();
    const perDay: Record<string, number> = {};
    for (const r of data) {
      allPhones.add(r.phone as string);
      if (r.first_clicked_at) {
        clickedPhones.add(r.phone as string);
        const day = (r.first_clicked_at as string).slice(0, 10);
        perDay[day] = (perDay[day] ?? 0) + 1;
      }
    }
    return { clicked: clickedPhones.size, trackedRecipients: allPhones.size, ctaUrl: (data[0].target_url as string) ?? null, perDayClicks: perDay };
  } catch { return empty; }   // table missing → zeros
}

const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

// Recipients who sent an inbound message after the campaign went out.
export async function campaignRepliedCount(campaignId: string, sentAt: string | null): Promise<number> {
  try {
    const { data: logs } = await db().from("wa_send_log").select("phone").eq("campaign_id", campaignId).limit(20000);
    if (!logs?.length) return 0;
    const recipients = new Set(logs.map(r => last10(r.phone as string)));
    const since = sentAt ?? "1970-01-01";
    const { data: convs } = await db().from("wa_conversations")
      .select("phone").gt("last_inbound_at", since).limit(20000);
    let replied = 0;
    const counted = new Set<string>();
    for (const c of convs ?? []) {
      const p = last10(c.phone as string);
      if (recipients.has(p) && !counted.has(p)) { counted.add(p); replied++; }
    }
    return replied;
  } catch { return 0; }
}

// Per-day delivery series from the send log (sent/delivered/read by date).
export async function campaignPerDay(campaignId: string, perDayClicks: Record<string, number>): Promise<CampaignDayPoint[]> {
  const days: Record<string, CampaignDayPoint> = {};
  const touch = (ts: string | null, key: "sent" | "delivered" | "read") => {
    if (!ts) return;
    const date = ts.slice(0, 10);
    days[date] = days[date] ?? { date, sent: 0, delivered: 0, read: 0, clicked: 0 };
    days[date][key]++;
  };
  try {
    const { data } = await db().from("wa_send_log")
      .select("sent_at, delivered_at, read_at").eq("campaign_id", campaignId).limit(20000);
    for (const r of data ?? []) {
      touch(r.sent_at as string | null, "sent");
      touch(r.delivered_at as string | null, "delivered");
      touch(r.read_at as string | null, "read");
    }
  } catch { /* no log → clicks only */ }
  for (const [date, n] of Object.entries(perDayClicks)) {
    days[date] = days[date] ?? { date, sent: 0, delivered: 0, read: 0, clicked: 0 };
    days[date].clicked = n;
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
}
