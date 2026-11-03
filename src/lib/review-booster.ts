// Google review booster — after a paid order, one WhatsApp message asking for a
// Google review, with a tracked link. NOT LIVE: only the platform owner's own
// workspace can use it (REVIEW_BOOSTER_LIVE), and every API answers 404 to
// anyone else, so tenants and the website never see it until it is switched on.
//
// Everyone is asked the same way. Google forbids "review gating" — sending only
// happy customers to Google — so the message invites a review from every
// customer, and offers a private reply to all of them alongside, never instead.
//
// WhatsApp lets a business message someone freely only within 24 hours of their
// last message; outside that it needs an approved template. v1 sends inside the
// window only and records the rest as skipped, with the reason.
//
// The link is the public "write a review" address: pasted in, or filled from
// the connected Business Profile (metadata.newReviewUri). The tracked link
// counts opens; it can't tell whether a review was then posted.

import crypto from "crypto";
import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { DEFAULT_TENANT_ID } from "./tenant";
import { getTenantSetting, setTenantSetting } from "./store";
import { listChannels, isLiveChannel } from "./channels";
import { locationReviewUrl } from "./googlereviews";
import { sendText } from "./whatsapp";

/** Flip to true to offer the booster to every workspace. */
export const REVIEW_BOOSTER_LIVE = false;
export function reviewBoosterAllowed(tenantId: string): boolean {
  return REVIEW_BOOSTER_LIVE || tenantId === DEFAULT_TENANT_ID;
}

const KEY = "review_booster";
const TABLE = "wa_review_requests";
export const SETUP_HINT = "The review booster isn't set up in the database yet. Apply migration 20261101180000_gaps_reviews.sql in Supabase, then reload.";

export interface BoosterConfig { enabled: boolean; reviewUrl: string; message: string; delayHours: number }
export const DEFAULT_MESSAGE = "Thank you for your order! 🙏 If you have a minute, a Google review helps us a lot:";

export async function getBoosterConfig(tenantId: string): Promise<BoosterConfig> {
  const v = await getTenantSetting<Partial<BoosterConfig> | null>(tenantId, KEY, null);
  return { enabled: !!v?.enabled, reviewUrl: v?.reviewUrl ?? "", message: v?.message || DEFAULT_MESSAGE, delayHours: v?.delayHours ?? 2 };
}

// share.google is the link Google's own "Share" button now hands out.
const GOOGLE_HOST = /(^|\.)(google\.[a-z.]+|g\.page|goo\.gl|maps\.app\.goo\.gl|share\.google)$/i;
/** A Google review address, https only. Pure. */
export function checkReviewUrl(u: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== "https:" || !GOOGLE_HOST.test(url.hostname)) return { ok: false, error: "Paste your Google review link (it starts with https://g.page/…, https://share.google/… or https://search.google.com/local/writereview…)." };
    return { ok: true, url: url.toString() };
  } catch { return { ok: false, error: "That isn't a web address." }; }
}

export async function saveBoosterConfig(tenantId: string, input: Partial<BoosterConfig>): Promise<{ config?: BoosterConfig; error?: string }> {
  const cur = await getBoosterConfig(tenantId);
  const next = { ...cur, ...input };
  if (next.enabled || input.reviewUrl !== undefined) {
    const c = checkReviewUrl(next.reviewUrl);
    if (!c.ok) return { error: c.error };
    next.reviewUrl = c.url;
  }
  next.message = (next.message || DEFAULT_MESSAGE).trim().slice(0, 600);
  next.delayHours = Math.min(72, Math.max(0, Math.round(Number(next.delayHours) || 0)));
  await setTenantSetting(tenantId, KEY, next);
  return { config: next };
}

/** The connected Google Business Profile, if any (for filling in the review link). */
export async function connectedGoogleProfile(tenantId: string) {
  return (await listChannels(tenantId)).find(c => c.kind === "google_reviews" && c.active && c.googleLocationId && c.token) ?? null;
}

/** Fill the review link from the connected Business Profile's own "write a review" address. */
export async function fillReviewUrlFromGoogle(tenantId: string): Promise<{ config?: BoosterConfig; error?: string }> {
  const ch = await connectedGoogleProfile(tenantId);
  if (!ch) return { error: "Connect your Google Business Profile first (the location button at the top of this page)." };
  const r = await locationReviewUrl({ channelId: ch.id, refreshToken: ch.token, accountId: ch.googleAccountId, locationId: ch.googleLocationId });
  if (!r.url) return { error: r.error ?? "Google didn't give a review link for this profile. Paste it instead." };
  return saveBoosterConfig(tenantId, { reviewUrl: r.url });
}

const linkBase = () => `https://${process.env.NEXT_PUBLIC_APP_HOST || "app.thetalko.in"}/r/rv/`;
/** The message every customer gets: the review invitation and, alongside it, a private way back. Pure. */
export function requestMessage(message: string, link: string): string {
  return `${message}\n\n⭐ ${link}\n\nSomething not right? Just reply here and we'll put it right.`;
}

async function whatsappChannel(tenantId: string) {
  const wa = (await listChannels(tenantId)).filter(c => c.kind === "whatsapp" && isLiveChannel(c));
  return wa.find(c => c.isDefault) ?? wa[0] ?? null;
}

/** Ask one customer. Once per order; skipped (with the reason) outside WhatsApp's 24-hour window. */
export async function requestReview(tenantId: string, phone: string, orderId: string | null, now = Date.now()): Promise<{ status: "sent" | "skipped" | "failed" | "duplicate"; detail?: string }> {
  if (!reviewBoosterAllowed(tenantId)) return { status: "skipped", detail: "Not available for this workspace yet." };
  const cfg = await getBoosterConfig(tenantId);
  if (!cfg.reviewUrl) return { status: "skipped", detail: "No Google review link saved." };
  const { data: conv } = await tdb(tenantId).from("wa_conversations").select("last_inbound_at").eq("phone", phone).eq("platform", "whatsapp").maybeSingle();
  const last = (conv as unknown as { last_inbound_at?: string | null } | null)?.last_inbound_at;
  const inWindow = !!last && now - Date.parse(last) < 24 * 3_600_000;
  const token = Array.from(crypto.randomBytes(12), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const row = { phone, order_id: orderId, token, sent_at: new Date(now).toISOString(), status: inWindow ? "sent" : "skipped", detail: inWindow ? null : "Outside WhatsApp's 24-hour window: this customer hasn't messaged you in the last 24 hours, so WhatsApp won't deliver it. Once they message your WhatsApp number, send again." };
  const { error } = await tdb(tenantId).from(TABLE).insert(row);
  if (error) return error.code === "23505" ? { status: "duplicate" } : { status: "failed", detail: error.message };
  if (!inWindow) return { status: "skipped", detail: row.detail as string };
  const channel = await whatsappChannel(tenantId);
  const sent = await sendText(phone, requestMessage(cfg.message, linkBase() + token), channel ?? undefined).catch(e => ({ error: e instanceof Error ? e.message : "send failed" }));
  if (!("id" in sent) || !sent.id) {
    const detail = ("error" in sent && sent.error) || "WhatsApp didn't accept the message.";
    await tdb(tenantId).from(TABLE).update({ status: "failed", detail }).eq("token", token);
    return { status: "failed", detail };
  }
  return { status: "sent" };
}

/** Background engine: paid orders past the delay that haven't been asked yet. Bounded per tick. */
export async function drainReviewBooster(now = Date.now(), max = 20): Promise<{ asked: number }> {
  const tenants = REVIEW_BOOSTER_LIVE
    ? ((await db().from("wa_settings").select("tenant_id,value").eq("key", KEY)).data ?? []).filter(r => (r.value as BoosterConfig)?.enabled).map(r => r.tenant_id as string)
    : [DEFAULT_TENANT_ID];
  let asked = 0;
  for (const tid of tenants) {
    const cfg = await getBoosterConfig(tid);
    if (!cfg.enabled || !cfg.reviewUrl) continue;
    const { data: orders } = await tdb(tid).from("wa_orders").select("id,phone,paid_at")
      .in("status", ["paid", "fulfilled"]).gte("paid_at", new Date(now - 7 * 86_400_000).toISOString())
      .lt("paid_at", new Date(now - cfg.delayHours * 3_600_000).toISOString()).order("paid_at", { ascending: true }).limit(100);
    const list = (orders ?? []) as unknown as { id: string; phone: string }[];
    if (!list.length) continue;
    const { data: done } = await tdb(tid).from(TABLE).select("order_id").in("order_id", list.map(o => o.id));
    const already = new Set(((done ?? []) as unknown as { order_id: string }[]).map(d => d.order_id));
    for (const o of list) {
      if (asked >= max) return { asked };
      if (already.has(o.id)) continue;
      const r = await requestReview(tid, o.phone, o.id, now);
      if (r.status === "sent") asked++;
    }
  }
  return { asked };
}

/** The tracked link was opened: count it, and send them on to the review page. */
export async function openReviewLink(token: string): Promise<string | null> {
  if (!/^[a-z0-9]{12}$/.test(token)) return null;
  const { data } = await db().from(TABLE).select("id,tenant_id,clicks,clicked_at").eq("token", token).maybeSingle();
  const r = data as { id: string; tenant_id: string; clicks: number; clicked_at: string | null } | null;
  if (!r) return null;
  await db().from(TABLE).update({ clicks: (r.clicks ?? 0) + 1, ...(r.clicked_at ? {} : { clicked_at: new Date().toISOString() }) }).eq("id", r.id);
  const cfg = await getBoosterConfig(r.tenant_id);
  return cfg.reviewUrl || null;
}

export async function boosterStats(tenantId: string, days = 30): Promise<{ sent: number; opened: number; skipped: number; failed: number; recent: { phoneTail: string; status: string; detail: string | null; sentAt: string; clickedAt: string | null }[]; setupNeeded?: string }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await tdb(tenantId).from(TABLE).select("phone,status,detail,sent_at,clicked_at").gte("sent_at", since).order("sent_at", { ascending: false }).limit(500);
  if (error) {
    if (/wa_review_requests|schema cache|does not exist/i.test(error.message)) return { sent: 0, opened: 0, skipped: 0, failed: 0, recent: [], setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as { phone: string; status: string; detail: string | null; sent_at: string; clicked_at: string | null }[];
  return {
    sent: rows.filter(r => r.status === "sent").length,
    opened: rows.filter(r => r.clicked_at).length,
    skipped: rows.filter(r => r.status === "skipped").length,
    failed: rows.filter(r => r.status === "failed").length,
    recent: rows.slice(0, 25).map(r => ({ phoneTail: r.phone.slice(-4), status: r.status, detail: r.detail, sentAt: r.sent_at, clickedAt: r.clicked_at })),
  };
}
