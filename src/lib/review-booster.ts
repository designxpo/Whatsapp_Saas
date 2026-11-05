// Review requests — asking customers for a Google review on WhatsApp after a
// paid order, after a completed service (an event a connected tool sends, e.g.
// Mezvaan's "bill paid"), or by hand. Available to every workspace whose plan
// includes Google Reviews.
//
// Everyone eligible is asked the same way. Google forbids "review gating" —
// sending only happy customers to Google — so the message invites a review
// from every customer and offers a private reply to all of them alongside,
// never instead. No incentives.
//
// Requests are a queue (wa_review_requests). Each is scheduled once per order,
// event or manual send (a unique source reference), then sent when due. Before
// sending, every request is checked again: the plan, that requests are still
// on, that its location is still connected, the customer's opt-out, how
// recently they were last asked, and quiet hours. WhatsApp lets a business
// message someone freely only within 24 hours of their last message; outside
// that an approved template is used — and a marketing template only reaches
// customers who opted in. Anything that can't be sent is recorded with the
// reason, never dropped silently. A row is claimed before sending, so a retry
// or an overlapping run can't send it twice.
//
// The link in the message is tracked (/r/rv/<token>): it counts opens and then
// redirects to Google. An open does NOT mean a review was written.

import crypto from "crypto";
import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getTenantSetting, setTenantSetting, appendConvMessage, isOptedOutStrict } from "./store";
import { listChannels, isLiveChannel, type Channel } from "./channels";
import { locationReviewUrl } from "./googlereviews";
import { sendText, sendTemplateSingle, fetchTemplates, bodyParamCount, dynamicUrlButtonIndexes, type WaTemplate } from "./whatsapp";
import { checkFeature } from "./entitlements";
import { accountCanSend } from "./feature-guard";
import { normalizePhone } from "./inbound/normalize";
import { partsIn, atHourIn, addDaysIn } from "./businessclock";
import { consentMissing } from "./audience";
import { getChannelSync } from "./reviews";

const KEY = "review_booster";
const TABLE = "wa_review_requests";
export const SETUP_HINT = "Review requests are still being set up for your workspace. Try again shortly.";

export interface RequestConfig {
  enabled: boolean;
  /** The connected Google location whose review link is used (null = the explicit link). */
  locationId: string | null;
  /** An explicit review link; empty = the location's own link from Google. */
  reviewUrl: string;
  triggers: { paidOrder: boolean; events: string[] };
  delayMinutes: number;
  message: string;
  /** An approved WhatsApp template for customers outside the 24-hour window. */
  template: { name: string; language: string } | null;
  /** Don't ask the same customer again within this many days (0 = no limit). */
  frequencyDays: number;
  /** Business-local hours when nothing is sent, e.g. { start: 21, end: 9 }. */
  quietHours: { start: number; end: number } | null;
  /** One reminder if the link wasn't opened — only inside the 24-hour window. */
  reminder: { enabled: boolean; afterHours: number };
}

export const DEFAULT_MESSAGE = "Thank you for visiting us! 🙏 If you have a minute, a Google review helps us a lot:";
export const DEFAULT_CONFIG: RequestConfig = {
  enabled: false, locationId: null, reviewUrl: "", triggers: { paidOrder: true, events: [] }, delayMinutes: 120,
  message: DEFAULT_MESSAGE, template: null, frequencyDays: 30, quietHours: { start: 21, end: 9 }, reminder: { enabled: false, afterHours: 48 },
};

/** Review requests come with Google Reviews: the same plan feature. */
export async function reviewRequestsAllowed(tenantId: string): Promise<boolean> {
  return (await checkFeature(tenantId, "reviews").catch(() => ({ ok: false }))).ok;
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const EVENT_KEY = /^[a-z0-9_.:-]{2,80}$/i;

/** Pure: a stored config (this one, or the older review-booster shape) made valid. */
export function normalizeConfig(v: unknown): RequestConfig {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown> & { delayHours?: number };
  const t = (o.triggers && typeof o.triggers === "object" ? o.triggers : {}) as Record<string, unknown>;
  const q = o.quietHours as { start?: unknown; end?: unknown } | null | undefined;
  const r = (o.reminder && typeof o.reminder === "object" ? o.reminder : {}) as Record<string, unknown>;
  const tpl = o.template as { name?: unknown; language?: unknown } | null | undefined;
  return {
    enabled: o.enabled === true,
    locationId: typeof o.locationId === "string" && o.locationId ? o.locationId : null,
    reviewUrl: typeof o.reviewUrl === "string" ? o.reviewUrl.trim() : "",
    triggers: {
      paidOrder: typeof t.paidOrder === "boolean" ? t.paidOrder : true,
      events: Array.isArray(t.events) ? [...new Set(t.events.filter((e): e is string => typeof e === "string" && EVENT_KEY.test(e.trim())).map(e => e.trim()))].slice(0, 10) : [],
    },
    // The older booster stored hours.
    delayMinutes: o.delayMinutes !== undefined ? clampInt(o.delayMinutes, 0, 7 * 24 * 60, 120) : o.delayHours !== undefined ? clampInt(Number(o.delayHours) * 60, 0, 7 * 24 * 60, 120) : DEFAULT_CONFIG.delayMinutes,
    message: (typeof o.message === "string" && o.message.trim() ? o.message.trim() : DEFAULT_MESSAGE).slice(0, 600),
    template: tpl && typeof tpl.name === "string" && tpl.name.trim() ? { name: tpl.name.trim().slice(0, 120), language: typeof tpl.language === "string" && tpl.language ? tpl.language : "en" } : null,
    frequencyDays: o.frequencyDays !== undefined ? clampInt(o.frequencyDays, 0, 365, 30) : 30,
    quietHours: q === null ? null : q && typeof q === "object" ? { start: clampInt(q.start, 0, 23, 21), end: clampInt(q.end, 0, 23, 9) } : DEFAULT_CONFIG.quietHours,
    reminder: { enabled: r.enabled === true, afterHours: clampInt(r.afterHours, 2, 23, 20) },
  };
}

export async function getRequestConfig(tenantId: string): Promise<RequestConfig> {
  return normalizeConfig(await getTenantSetting<unknown>(tenantId, KEY, null).catch(() => null));
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

/** The connected Google locations of this workspace. */
async function googleLocations(tenantId: string): Promise<Channel[]> {
  return (await listChannels(tenantId)).filter(c => c.kind === "google_reviews" && c.active && c.googleLocationId && c.token);
}

/** The review link a request uses: the explicit one, else the chosen location's own. */
export async function resolveReviewUrl(tenantId: string, cfg: RequestConfig): Promise<string> {
  if (cfg.reviewUrl) return cfg.reviewUrl;
  if (!cfg.locationId) return "";
  return (await getChannelSync(tenantId, cfg.locationId)).reviewUri ?? "";
}

export async function saveRequestConfig(tenantId: string, input: Partial<RequestConfig>): Promise<{ config?: RequestConfig; error?: string }> {
  const cur = await getRequestConfig(tenantId);
  const next = normalizeConfig({ ...cur, ...input, triggers: { ...cur.triggers, ...(input.triggers ?? {}) }, reminder: { ...cur.reminder, ...(input.reminder ?? {}) } });
  if (next.reviewUrl) {
    const c = checkReviewUrl(next.reviewUrl);
    if (!c.ok) return { error: c.error };
    next.reviewUrl = c.url;
  }
  if (next.locationId && !(await googleLocations(tenantId)).some(l => l.id === next.locationId)) return { error: "That location isn't connected to this workspace." };
  if (next.enabled) {
    if (!(await resolveReviewUrl(tenantId, next))) return { error: "Choose a connected location (Talko uses its own review link) or paste your Google review link before switching requests on." };
    if (!next.triggers.paidOrder && !next.triggers.events.length) return { error: "Choose when to ask: after paid orders, after an event from a connected tool, or both." };
  }
  await setTenantSetting(tenantId, KEY, next);
  // Switching requests off stops everything already waiting.
  if (cur.enabled && !next.enabled) {
    await tdb(tenantId).from(TABLE).update({ status: "cancelled", detail: "Review requests were switched off." }).eq("status", "scheduled");
  }
  return { config: next };
}

/** Fill the explicit link from a connected location's own "write a review" address. */
export async function fillReviewUrlFromGoogle(tenantId: string, locationId?: string | null): Promise<{ config?: RequestConfig; error?: string }> {
  const locs = await googleLocations(tenantId);
  const ch = (locationId ? locs.find(l => l.id === locationId) : null) ?? locs[0];
  if (!ch) return { error: "Connect your Google Business Profile first (Google locations, at the top of this page)." };
  const r = await locationReviewUrl({ channelId: ch.id, refreshToken: ch.token, accountId: ch.googleAccountId, locationId: ch.googleLocationId });
  if (!r.url) return { error: r.error ?? "Google didn't give a review link for this location. Paste it instead." };
  return saveRequestConfig(tenantId, { reviewUrl: r.url, locationId: ch.id });
}

/** Back-compat for callers of the older booster. */
export async function connectedGoogleProfile(tenantId: string) {
  return (await googleLocations(tenantId))[0] ?? null;
}

const linkBase = () => `https://${process.env.NEXT_PUBLIC_APP_HOST || "app.thetalko.in"}/r/rv/`;
/** The message every customer gets: the review invitation and, alongside it, a private way back. Pure. */
export function requestMessage(message: string, link: string): string {
  return `${message}\n\n⭐ ${link}\n\nSomething not right? Just reply here and we'll put it right.`;
}
export function reminderMessage(link: string): string {
  return `A gentle reminder — if you have a moment, we'd really value your Google review:\n\n⭐ ${link}\n\nIf anything wasn't right, just reply here.`;
}

const newToken = () => Array.from(crypto.randomBytes(12), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** Pure: is this hour (business time) inside quiet hours? */
export function inQuietHours(hour: number, q: RequestConfig["quietHours"]): boolean {
  if (!q || q.start === q.end) return false;
  return q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

/** Pure-ish: the first moment at or after `at` outside quiet hours (business time). */
export function afterQuietHours(at: Date, q: RequestConfig["quietHours"]): Date {
  if (!q || !inQuietHours(partsIn(at).hour, q)) return at;
  const today = atHourIn(at, q.end);
  return today.getTime() > at.getTime() ? today : atHourIn(addDaysIn(at, 1), q.end);
}

export interface ScheduleInput {
  phone: string; name?: string | null;
  source: "order" | "event" | "manual";
  sourceRef: string;
  orderId?: string | null;
  eventKey?: string | null;
  reviewUrl?: string | null;
  channelId?: string | null;
  sendAfter: Date;
}

/** Queue one request. "duplicate" when this order/event was already queued. */
export async function scheduleRequest(tenantId: string, s: ScheduleInput): Promise<{ status: "scheduled" | "duplicate" | "invalid" | "failed"; id?: string; detail?: string }> {
  const phone = normalizePhone(s.phone);
  if (!phone) return { status: "invalid", detail: "That isn't a WhatsApp number." };
  const { data, error } = await tdb(tenantId).from(TABLE).insert({
    phone, name: s.name?.slice(0, 80) ?? null, source: s.source, source_ref: s.sourceRef.slice(0, 200), order_id: s.orderId ?? null,
    event_key: s.eventKey ?? null, review_url: s.reviewUrl ?? null, channel_id: s.channelId ?? null,
    token: newToken(), status: "scheduled", send_after: s.sendAfter.toISOString(),
  }).select("id");
  if (error) return error.code === "23505" ? { status: "duplicate" } : { status: "failed", detail: error.message };
  return { status: "scheduled", id: ((data ?? []) as unknown as { id: string }[])[0]?.id };
}

// The id an event carries for itself, so a retried event is recognised.
function eventRef(eventKey: string, phone: string, payload: Record<string, unknown>, now: number): string {
  for (const k of ["bill_id", "order_id", "booking_id", "appointment_id", "payment_id", "invoice_no", "id"]) {
    const v = payload[k];
    if ((typeof v === "string" && v) || typeof v === "number") return `${eventKey}:${String(v)}`;
  }
  // Nothing to tell events apart: at most one request per person per event per day.
  return `${eventKey}:${phone}:${new Date(now).toISOString().slice(0, 10)}`;
}

/**
 * A connected tool reported something (apirules.processEvent): if this
 * workspace asks for reviews after this event, queue one. Mezvaan's "bill paid"
 * carries its outlet's own review link, used in place of the workspace's.
 */
export async function queueFromEvent(tenantId: string, eventKey: string, phone: string, name: string | undefined, payload: Record<string, unknown> = {}, now = Date.now()): Promise<"scheduled" | "duplicate" | "ignored"> {
  const cfg = await getRequestConfig(tenantId);
  if (!cfg.enabled || !cfg.triggers.events.includes(eventKey)) return "ignored";
  if (!(await reviewRequestsAllowed(tenantId))) return "ignored";
  const own = typeof payload.review_url === "string" && checkReviewUrl(payload.review_url).ok ? (checkReviewUrl(payload.review_url) as { url: string }).url : null;
  const p = normalizePhone(phone);
  if (!p) return "ignored";
  const r = await scheduleRequest(tenantId, {
    phone: p, name, source: "event", sourceRef: eventRef(eventKey, p, payload, now), eventKey,
    reviewUrl: own, channelId: cfg.locationId, sendAfter: new Date(now + cfg.delayMinutes * 60_000),
  });
  return r.status === "scheduled" ? "scheduled" : r.status === "duplicate" ? "duplicate" : "ignored";
}

interface RequestRow {
  id: string; tenant_id: string; phone: string; name: string | null; token: string; status: string;
  source: string; order_id: string | null; review_url: string | null; channel_id: string | null;
  send_after: string | null; attempts: number; sent_at: string | null; clicked_at: string | null; reminder_sent_at: string | null; via: string | null;
}

async function whatsappChannel(tenantId: string): Promise<Channel | null> {
  const wa = (await listChannels(tenantId)).filter(c => c.kind === "whatsapp" && isLiveChannel(c));
  return wa.find(c => c.isDefault) ?? wa[0] ?? null;
}

/** Pure: the values an approved template needs to carry the tracked link. */
export function templateValues(t: Pick<WaTemplate, "components">, link: string, token: string): { body: string[]; buttons: string[] } | { error: string } {
  const bodyVars = bodyParamCount(t);
  const dyn = dynamicUrlButtonIndexes(t);
  if (bodyVars > 1) return { error: "The chosen template has more than one variable. Use one whose only variable ({{1}}) is where the review link goes." };
  if (dyn.length > 1) return { error: "The chosen template has more than one link button with a variable." };
  if (!bodyVars && !dyn.length) return { error: "The chosen template has no place for the review link. Use one with {{1}} in its text, or a link button ending in {{1}}." };
  return { body: bodyVars ? [link] : [], buttons: dyn.length ? [token] : [] };
}

type Outcome = { status: "sent" | "skipped" | "failed" | "cancelled" | "rescheduled"; detail?: string };

/**
 * Send one claimed request (status "sending"), checking everything again at
 * send time. `manual` skips the delay and quiet hours (a person chose to send now).
 */
async function deliver(row: RequestRow, now: number, manual: boolean, cache: Map<string, WaTemplate[]>): Promise<Outcome> {
  const tenantId = row.tenant_id;
  if (!(await reviewRequestsAllowed(tenantId)) || !(await accountCanSend(tenantId).catch(() => false))) {
    return { status: "cancelled", detail: "Your plan or account doesn't allow review requests right now." };
  }
  const cfg = await getRequestConfig(tenantId);
  if (!cfg.enabled && !manual) return { status: "cancelled", detail: "Review requests were switched off." };
  if (row.channel_id && !(await googleLocations(tenantId)).some(l => l.id === row.channel_id)) {
    return { status: "cancelled", detail: "The Google location this request was for was disconnected." };
  }
  const reviewUrl = row.review_url || (await resolveReviewUrl(tenantId, cfg));
  if (!reviewUrl) return { status: "skipped", detail: "No Google review link is set." };
  if (await isOptedOutStrict(row.phone, tenantId).catch(() => true)) return { status: "skipped", detail: "This customer has opted out of messages." };
  if (cfg.frequencyDays > 0) {
    const since = new Date(now - cfg.frequencyDays * 86_400_000).toISOString();
    const { data } = await tdb(tenantId).from(TABLE).select("id").eq("phone", row.phone).eq("status", "sent").gte("sent_at", since).neq("id", row.id).limit(1);
    if ((data ?? []).length) return { status: "skipped", detail: `Already asked in the last ${cfg.frequencyDays} days.` };
  }
  if (!manual && inQuietHours(partsIn(new Date(now)).hour, cfg.quietHours)) {
    return { status: "rescheduled", detail: afterQuietHours(new Date(now), cfg.quietHours).toISOString() };
  }

  const { data: conv } = await tdb(tenantId).from("wa_conversations").select("id,channel_id,last_inbound_at").eq("phone", row.phone).eq("platform", "whatsapp").maybeSingle();
  const chat = conv as unknown as { id?: string; channel_id?: string | null; last_inbound_at?: string | null } | null;
  const inWindow = !!chat?.last_inbound_at && now - Date.parse(chat.last_inbound_at) < 24 * 3_600_000;
  const channel = await whatsappChannel(tenantId);
  if (!channel) return { status: "failed", detail: "No WhatsApp number is connected to send from." };
  const link = linkBase() + row.token;

  let sent: { id?: string; error?: string };
  let via: "text" | "template";
  let body: string;
  if (inWindow) {
    via = "text"; body = requestMessage(cfg.message, link);
    sent = await sendText(row.phone, body, channel).catch(e => ({ error: e instanceof Error ? e.message : "send failed" }));
  } else {
    if (!cfg.template) return { status: "skipped", detail: "Outside WhatsApp's 24-hour window and no approved template is chosen. Choose one in Review requests, or the customer can message you first." };
    let list = cache.get(tenantId);
    if (!list) { list = await fetchTemplates(channel).catch(() => [] as WaTemplate[]); cache.set(tenantId, list); }
    const tpl = list.find(t => t.name === cfg.template!.name && t.language === cfg.template!.language) ?? list.find(t => t.name === cfg.template!.name);
    if (!tpl || tpl.status !== "APPROVED") return { status: "skipped", detail: `The template “${cfg.template.name}” isn't approved by WhatsApp (yet).` };
    if (tpl.category === "MARKETING" && (await consentMissing([row.phone], tenantId).catch(() => new Set([row.phone]))).size) {
      return { status: "skipped", detail: "This customer hasn't opted in to marketing messages, and the chosen template is a marketing template." };
    }
    const values = templateValues(tpl, link, row.token);
    if ("error" in values) return { status: "skipped", detail: values.error };
    via = "template"; body = `[Template: ${tpl.name}] ${link}`;
    sent = await sendTemplateSingle(row.phone, tpl.name, tpl.language, values.body, channel, undefined, values.buttons.length ? values.buttons : undefined)
      .catch(e => ({ error: e instanceof Error ? e.message : "send failed" }));
  }
  if (!sent.id) return { status: "failed", detail: sent.error || "WhatsApp didn't accept the message." };
  await tdb(tenantId).from(TABLE).update({ via, review_url: reviewUrl }).eq("id", row.id);
  // Show it in the customer's chat, as every other message from the business
  // number is. It isn't a reply, so the chat's "needs a reply" state is left alone.
  if (chat?.id) {
    await appendConvMessage({ conversationId: chat.id, role: "assistant", body, metaId: sent.id, source: "bot", tenantId, channelId: channel.id ?? chat.channel_id ?? null })
      .catch(e => console.error("[review-requests] chat log", tenantId, e));
  }
  return { status: "sent" };
}

async function settle(row: RequestRow, o: Outcome, now: number): Promise<void> {
  const at = new Date(now).toISOString();
  const patch: Record<string, unknown> =
    o.status === "rescheduled" ? { status: "scheduled", send_after: o.detail, detail: "Waiting for quiet hours to end." }
    : o.status === "sent" ? { status: "sent", sent_at: at, detail: null }
    // A temporary send failure gets two more tries, ten minutes apart.
    : o.status === "failed" && (row.attempts ?? 0) < 2 && !/No WhatsApp number/.test(o.detail ?? "") ? { status: "scheduled", send_after: new Date(now + 10 * 60_000).toISOString(), detail: o.detail, attempts: (row.attempts ?? 0) + 1 }
    : { status: o.status, detail: o.detail ?? null, sent_at: o.status === "skipped" || o.status === "failed" ? at : null };
  await tdb(row.tenant_id).from(TABLE).update(patch).eq("id", row.id).eq("status", "sending");
}

/** Claim a scheduled request for sending. True only for the caller that won. */
async function claim(row: Pick<RequestRow, "id" | "tenant_id">): Promise<boolean> {
  const { data } = await tdb(row.tenant_id).from(TABLE).update({ status: "sending" }).eq("id", row.id).eq("status", "scheduled").select("id");
  return (data ?? []).length > 0;
}

const SELECT = "id,tenant_id,phone,name,token,status,source,order_id,review_url,channel_id,send_after,attempts,sent_at,clicked_at,reminder_sent_at,via";

/** Ask one customer now (a person chose to). Scheduled and sent straight away, with every check. */
export async function sendNow(tenantId: string, phone: string, name?: string | null, now = Date.now()): Promise<{ status: string; detail?: string }> {
  if (!(await reviewRequestsAllowed(tenantId))) return { status: "skipped", detail: "Review requests aren't included in your plan." };
  const p = normalizePhone(phone);
  if (!p) return { status: "invalid", detail: "Enter the customer's WhatsApp number, e.g. 98XXXXXXXX or +91 98XXXXXXXX." };
  const s = await scheduleRequest(tenantId, { phone: p, name, source: "manual", sourceRef: `manual:${p}:${now}`, sendAfter: new Date(now) });
  if (s.status !== "scheduled" || !s.id) return { status: s.status, detail: s.detail };
  const { data } = await tdb(tenantId).from(TABLE).select(SELECT).eq("id", s.id).maybeSingle();
  const row = data as unknown as RequestRow;
  if (!(await claim(row))) return { status: "duplicate" };
  const o = await deliver({ ...row, status: "sending" }, now, true, new Map());
  await settle({ ...row, attempts: 2 }, o, now);   // manual: the person sees the outcome, so no silent retries
  return { status: o.status, detail: o.detail };
}

/** Queue requests for paid orders past the delay, for every workspace that asks after orders. */
async function scheduleFromOrders(now: number): Promise<number> {
  const { data } = await db().from("wa_settings").select("tenant_id,value").eq("key", KEY);
  let scheduled = 0;
  for (const r of (data ?? []) as { tenant_id: string; value: unknown }[]) {
    const cfg = normalizeConfig(r.value);
    if (!cfg.enabled || !cfg.triggers.paidOrder) continue;
    const { data: orders } = await tdb(r.tenant_id).from("wa_orders").select("id,phone,paid_at")
      .in("status", ["paid", "fulfilled"]).gte("paid_at", new Date(now - 7 * 86_400_000).toISOString())
      .order("paid_at", { ascending: true }).limit(100);
    for (const o of (orders ?? []) as unknown as { id: string; phone: string; paid_at: string }[]) {
      const s = await scheduleRequest(r.tenant_id, {
        phone: o.phone, source: "order", sourceRef: `order:${o.id}`, orderId: o.id, channelId: cfg.locationId,
        sendAfter: new Date(Date.parse(o.paid_at) + cfg.delayMinutes * 60_000),
      });
      if (s.status === "scheduled") scheduled++;
    }
  }
  return scheduled;
}

/** One reminder, inside the 24-hour window only, if the link wasn't opened. */
async function sendReminders(now: number, max: number): Promise<number> {
  const { data } = await db().from(TABLE).select(SELECT).eq("status", "sent").is("clicked_at", null).is("reminder_sent_at", null)
    .gte("sent_at", new Date(now - 3 * 86_400_000).toISOString()).limit(max);
  let sent = 0;
  for (const row of (data ?? []) as unknown as RequestRow[]) {
    const cfg = await getRequestConfig(row.tenant_id);
    if (!cfg.enabled || !cfg.reminder.enabled || !row.sent_at) continue;
    if (now - Date.parse(row.sent_at) < cfg.reminder.afterHours * 3_600_000) continue;
    // Claim it first: only one run reminds.
    const { data: mine } = await tdb(row.tenant_id).from(TABLE).update({ reminder_sent_at: new Date(now).toISOString() }).eq("id", row.id).is("reminder_sent_at", null).select("id");
    if (!(mine ?? []).length) continue;
    if (!(await reviewRequestsAllowed(row.tenant_id)) || await isOptedOutStrict(row.phone, row.tenant_id).catch(() => true)) continue;
    if (inQuietHours(partsIn(new Date(now)).hour, cfg.quietHours)) { await tdb(row.tenant_id).from(TABLE).update({ reminder_sent_at: null }).eq("id", row.id); continue; }
    const { data: conv } = await tdb(row.tenant_id).from("wa_conversations").select("last_inbound_at").eq("phone", row.phone).eq("platform", "whatsapp").maybeSingle();
    const last = (conv as unknown as { last_inbound_at?: string | null } | null)?.last_inbound_at;
    if (!last || now - Date.parse(last) >= 24 * 3_600_000) continue;   // not permitted outside the window: no reminder
    const channel = await whatsappChannel(row.tenant_id);
    if (!channel) continue;
    const r = await sendText(row.phone, reminderMessage(linkBase() + row.token), channel).catch(() => ({ id: undefined }));
    if (r.id) sent++;
  }
  return sent;
}

/** Background engine: queue from paid orders, send what's due, then reminders. Bounded per run. */
export async function drainReviewRequests(now = Date.now(), max = 25): Promise<{ scheduled: number; sent: number; skipped: number; reminders: number }> {
  const out = { scheduled: 0, sent: 0, skipped: 0, reminders: 0 };
  out.scheduled = await scheduleFromOrders(now).catch(e => { console.error("[review-requests] orders", e); return 0; });
  const { data, error } = await db().from(TABLE).select(SELECT).eq("status", "scheduled").lte("send_after", new Date(now).toISOString())
    .order("send_after", { ascending: true }).limit(max);
  if (error) return out;
  const cache = new Map<string, WaTemplate[]>();
  for (const row of (data ?? []) as unknown as RequestRow[]) {
    if (!(await claim(row))) continue;
    const o = await deliver({ ...row, status: "sending" }, now, false, cache).catch(e => ({ status: "failed" as const, detail: e instanceof Error ? e.message : "send failed" }));
    await settle(row, o, now);
    if (o.status === "sent") out.sent++; else if (o.status === "skipped") out.skipped++;
  }
  out.reminders = await sendReminders(now, 25).catch(() => 0);
  return out;
}

/** Back-compat name for the cron stage. */
export async function drainReviewBooster(now = Date.now()): Promise<{ asked: number }> {
  return { asked: (await drainReviewRequests(now)).sent };
}

/** The tracked link was opened: count it, and send them on to the review page. */
export async function openReviewLink(token: string): Promise<string | null> {
  if (!/^[a-z0-9]{12}$/.test(token)) return null;
  const { data } = await db().from(TABLE).select("id,tenant_id,clicks,clicked_at,review_url").eq("token", token).maybeSingle();
  const r = data as { id: string; tenant_id: string; clicks: number; clicked_at: string | null; review_url: string | null } | null;
  if (!r) return null;
  await db().from(TABLE).update({ clicks: (r.clicks ?? 0) + 1, ...(r.clicked_at ? {} : { clicked_at: new Date().toISOString() }) }).eq("id", r.id);
  return r.review_url || (await resolveReviewUrl(r.tenant_id, await getRequestConfig(r.tenant_id))) || null;
}

export interface RequestStats {
  scheduled: number; sent: number; opened: number; skipped: number; failed: number; cancelled: number;
  recent: { phoneTail: string; name: string | null; status: string; source: string; detail: string | null; at: string; clickedAt: string | null }[];
  setupNeeded?: string;
}

export async function requestStats(tenantId: string, days = 30, now = Date.now()): Promise<RequestStats> {
  const since = new Date(now - days * 86_400_000).toISOString();
  const { data, error } = await tdb(tenantId).from(TABLE).select("phone,name,status,source,detail,created_at,sent_at,send_after,clicked_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
  const empty = { scheduled: 0, sent: 0, opened: 0, skipped: 0, failed: 0, cancelled: 0, recent: [] };
  if (error) {
    if (/wa_review_requests|schema cache|does not exist|column/i.test(error.message)) return { ...empty, setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as { phone: string; name: string | null; status: string; source: string; detail: string | null; created_at: string; sent_at: string | null; send_after: string | null; clicked_at: string | null }[];
  const count = (s: string) => rows.filter(r => r.status === s).length;
  return {
    scheduled: count("scheduled") + count("sending"), sent: count("sent"), opened: rows.filter(r => r.clicked_at).length,
    skipped: count("skipped"), failed: count("failed"), cancelled: count("cancelled"),
    recent: rows.slice(0, 25).map(r => ({ phoneTail: r.phone.slice(-4), name: r.name, status: r.status, source: r.source, detail: r.detail, at: r.sent_at ?? r.send_after ?? r.created_at, clickedAt: r.clicked_at })),
  };
}

/** Cancel what's waiting for a location that was disconnected. */
export async function cancelForLocation(tenantId: string, channelId: string): Promise<void> {
  await tdb(tenantId).from(TABLE).update({ status: "cancelled", detail: "The Google location was disconnected." }).eq("channel_id", channelId).eq("status", "scheduled");
}
