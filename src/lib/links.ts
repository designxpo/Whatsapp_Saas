import { DEFAULT_TENANT_ID } from "./tenant";
import { pageAll } from "./pagedselect";
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

// placeholder ("your-deployed-url.vercel.app") or at the localhost default.
// That is harmless for a redirect fallback but NOT for anything that bakes the
// URL in permanently — a template's URL button is submitted to Meta and
// approved once, so a dead domain there can't be corrected without
// resubmitting. Callers in that position should refuse rather than proceed.
export function usableOrigin(u: string): boolean {
  if (!u) return false;
  if (/localhost|127\.0\.0\.1/.test(u)) return false;
  if (/your-[a-z-]*(url|broadcaster|domain|app)|example\.com|changeme/i.test(u)) return false;
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(u);
}

export function siteUrlUsable(): boolean {
  return usableOrigin(siteUrl());
}

/**
 * A stored URL that is safe to put in a Location header, or null.
 *
 * Three public routes 302 to a value read out of the database: /r/<code> (a
 * template button's tracked target), /g/<slug> (a growth tool's link) and
 * /s/<slug> (a short link, which is always built as wa.me and so was never at
 * risk). None of them checked what they were redirecting to.
 *
 * ── Why this matters more after signup opens than before ────────────────────
 *
 * Today the target is set by an admin of the one business on the platform.
 * With self-serve signup, anyone with a WhatsApp number and two minutes
 * becomes an admin — and gets a redirector on the production domain, which is
 * the domain every WhatsApp template links to. A phishing page reached through
 * it costs the domain its reputation, and a domain flagged by Safe Browsing or
 * by Meta takes template delivery down with it.
 *
 * ── What this does and does not prevent ─────────────────────────────────────
 *
 * It rejects schemes that are not http(s): javascript:, data:, vbscript:,
 * file:, intent:. Most browsers already ignore those in a Location header, but
 * "most browsers, probably" is not a control, and the same stored value is
 * rendered as an href elsewhere, where javascript: very much does run.
 *
 * It does NOT restrict the host, and cannot: the entire purpose is to send
 * somebody to a customer's own site. Host-level abuse is answered by the
 * target being set by an authenticated admin, by the audit trail, and by
 * suspension — not here.
 */
export function safeRedirectTarget(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    // Relative or malformed. A redirect target is stored absolute; anything
    // else is a bug or an attempt, and neither should be followed.
    return null;
  }
  // http is allowed alongside https because existing customer links use it and
  // silently breaking them would be a worse outcome than the downgrade. The
  // scheme list is an allowlist rather than a denylist, so a scheme nobody has
  // thought of yet is refused by default rather than permitted by omission.
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u.toString();
}

// Origin to bake into a template's tracked button URL. The configured value
// wins when it's real (it's the deliberate, canonical choice), but a stale or
// placeholder NEXT_PUBLIC_SITE_URL shouldn't block anyone — the host the admin
// is submitting from is a perfectly good answer, and it can't be a placeholder.
// Returns null when neither is usable, so the caller refuses rather than baking
// a dead link into a template Meta approves permanently.
export function trackingOrigin(requestOrigin?: string | null): string | null {
  if (siteUrlUsable()) return siteUrl();
  const req = (requestOrigin ?? "").replace(/\/$/, "");
  return usableOrigin(req) ? req : null;
}

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
    // Paged: .limit(20000) never raised PostgREST's 1,000-row ceiling, so a campaign
    // to more than 1,000 recipients was measured on an arbitrary thousand of them —
    // "clicked" and "tracked recipients" both understated, with nothing to say so.
    const data = await pageAll<{ phone: string; target_url: string; first_clicked_at: string | null }>(
      () => db().from("wa_links").select("phone, target_url, first_clicked_at").eq("campaign_id", campaignId).order("id"),
      { cap: 200_000, label: "campaign_clicks" },
    );
    if (!data.length) return empty;
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
    return { clicked: clickedPhones.size, trackedRecipients: allPhones.size, ctaUrl: data[0].target_url ?? null, perDayClicks: perDay };
  } catch { return empty; }   // table missing → zeros
}

const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

// Recipients who sent an inbound message after the campaign went out.
//
// Scoped to the workspace: conversations are read for THIS tenant only. Without
// that, a reply from another workspace's chat with a matching phone number would
// count as a reply to this campaign.
export async function campaignRepliedCount(campaignId: string, sentAt: string | null, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  try {
    const logs = await pageAll<{ phone: string }>(
      () => db().from("wa_send_log").select("phone").eq("campaign_id", campaignId).order("id"),
      { cap: 200_000, label: "campaign_replies_log" },
    );
    if (!logs.length) return 0;
    const recipients = new Set(logs.map(r => last10(r.phone)));
    const since = sentAt ?? "1970-01-01";
    const convs = await pageAll<{ phone: string }>(
      () => db().from("wa_conversations").select("phone").eq("tenant_id", tenantId).gt("last_inbound_at", since).order("id"),
      { cap: 200_000, label: "campaign_replies_convs" },
    );
    let replied = 0;
    const counted = new Set<string>();
    for (const c of convs) {
      const p = last10(c.phone);
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
    const data = await pageAll<{ sent_at: string | null; delivered_at: string | null; read_at: string | null }>(
      () => db().from("wa_send_log").select("sent_at, delivered_at, read_at").eq("campaign_id", campaignId).order("id"),
      { cap: 200_000, label: "campaign_per_day" },
    );
    for (const r of data) {
      touch(r.sent_at, "sent");
      touch(r.delivered_at, "delivered");
      touch(r.read_at, "read");
    }
  } catch { /* no log → clicks only */ }
  for (const [date, n] of Object.entries(perDayClicks)) {
    days[date] = days[date] ?? { date, sent: 0, delivered: 0, read: 0, clicked: 0 };
    days[date].clicked = n;
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
}
