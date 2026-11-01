// WhatsApp handoff — a comment or DM on Instagram, Facebook or YouTube
// continues on WhatsApp, with its context.
//
// A comment rule with "Continue on WhatsApp" gives the person a personal code:
//  - Instagram/Facebook: hidden in a wa.me link's prefilled message (Handle
//    Hub's invisible encoding), on a "Continue on WhatsApp" button in the DM;
//  - YouTube, which hides replies with links: a short typed code, "YT-4821",
//    with the number in a comment the channel pins.
// When a WhatsApp message carries the code, the handoff is claimed — once, by
// the first number that sends it, only within the workspace that owns the
// receiving WhatsApp number — the contact learns where it came from, and the
// rule's WhatsApp message goes out.
//
// Codes: 10 characters for links (Handle Hub source codes are 7 and session
// codes 12, so the three never collide), YT-dddd typed. 30 days to use.

import crypto from "crypto";
import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { listEntryPoints, withInvisibleRef } from "./handlehub";
import { errorMessage } from "./errors";

export type HandoffPlatform = "instagram" | "facebook" | "youtube";
export interface Handoff {
  id: string; tenantId: string; code: string; platform: HandoffPlatform; channelId: string | null;
  sourceKind: "comment" | "dm"; sourceRef: string | null; postId: string | null; sourceText: string | null; sourceAuthor: string | null;
  ruleId: string | null; message: string | null; createdAt: string; expiresAt: string;
  claimedAt: string | null; claimedPhone: string | null; claimedConversationId: string | null;
}

const TABLE = "wa_handoffs";
const LINK_CODE_LEN = 10;
const B36 = "abcdefghijklmnopqrstuvwxyz0123456789";
export const PLATFORM_LABEL: Record<HandoffPlatform, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
export const SETUP_HINT = "WhatsApp handoff isn't set up in the database yet. Apply migration 20261101160000_whatsapp_handoff.sql in Supabase, then reload.";

function map(r: Record<string, unknown>): Handoff {
  return {
    id: r.id as string, tenantId: r.tenant_id as string, code: r.code as string, platform: r.platform as HandoffPlatform,
    channelId: (r.channel_id as string | null) ?? null, sourceKind: (r.source_kind as Handoff["sourceKind"]) ?? "comment",
    sourceRef: (r.source_ref as string | null) ?? null, postId: (r.post_id as string | null) ?? null,
    sourceText: (r.source_text as string | null) ?? null, sourceAuthor: (r.source_author as string | null) ?? null,
    ruleId: (r.rule_id as string | null) ?? null, message: (r.message as string | null) ?? null,
    createdAt: r.created_at as string, expiresAt: r.expires_at as string,
    claimedAt: (r.claimed_at as string | null) ?? null, claimedPhone: (r.claimed_phone as string | null) ?? null,
    claimedConversationId: (r.claimed_conversation_id as string | null) ?? null,
  };
}

export function newLinkCode(): string {
  return Array.from(crypto.randomBytes(LINK_CODE_LEN), b => B36[b % 36]).join("");
}
export function newTypedCode(): string {
  return `YT-${crypto.randomInt(1000, 10000)}`;
}

/** The code in a WhatsApp message: a hidden link code (already decoded by Handle Hub), or a typed YouTube one. */
export function handoffCodeIn(text: string, hiddenRef: string | null): string | null {
  if (hiddenRef && hiddenRef.length === LINK_CODE_LEN) return hiddenRef.toLowerCase();
  const typed = (text || "").match(/\byt[\s-]?(\d{4})\b/i);
  return typed ? `YT-${typed[1]}` : null;
}

/** Make a handoff. Null when it can't be stored — the caller sends its DM / reply without the invitation. */
export async function createHandoff(h: {
  tenantId: string; platform: HandoffPlatform; channelId: string | null; sourceKind?: "comment" | "dm";
  sourceRef?: string | null; postId?: string | null; sourceText?: string | null; sourceAuthor?: string | null;
  ruleId?: string | null; message?: string | null;
}): Promise<Handoff | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = h.platform === "youtube" ? newTypedCode() : newLinkCode();
    try {
      const { data, error } = await tdb(h.tenantId).from(TABLE).insert({
        code, platform: h.platform, channel_id: h.channelId, source_kind: h.sourceKind ?? "comment",
        source_ref: h.sourceRef ?? null, post_id: h.postId ?? null, source_text: h.sourceText?.slice(0, 2000) ?? null,
        source_author: h.sourceAuthor?.slice(0, 200) || null, rule_id: h.ruleId ?? null, message: h.message?.trim().slice(0, 4000) || null,
      }).select("*").maybeSingle();
      if (!error && data) return map(data as unknown as Record<string, unknown>);
      if (error?.code !== "23505") { console.warn("[handoff] create failed:", error?.message); return null; }
      // 23505: that code is taken in this workspace — draw another.
    } catch (e) {
      console.warn("[handoff] create failed:", errorMessage(e));
      return null;
    }
  }
  return null;
}

/** The workspace's WhatsApp number for invitations: its first Handle Hub entry point (country code included). */
export async function handoffNumber(tenantId: string): Promise<{ number: string; greeting: string } | null> {
  const ep = (await listEntryPoints(tenantId).catch(() => []))[0];
  return ep?.number ? { number: ep.number, greeting: ep.greeting } : null;
}

/** The wa.me link that carries this handoff's code, hidden in a friendly first message. */
export function handoffLink(number: string, code: string, greeting?: string | null): string {
  const text = (greeting || "").trim() || "Hi! I'd like to continue here.";
  return `https://wa.me/${number}?text=${encodeURIComponent(withInvisibleRef(text, code))}`;
}

/** The sentence a YouTube reply ends with — no link, no number (YouTube hides replies with either). */
export function youtubeInvite(code: string): string {
  return `Send code ${code} to us on WhatsApp (number in the pinned comment).`;
}

/**
 * Claim the handoff a WhatsApp message carries. Only within this workspace, only
 * while open and unexpired, only once. A second message from the same number
 * with the same code finds it already theirs and is not treated as new.
 */
export async function claimHandoff(tenantId: string, code: string, phone: string): Promise<Handoff | null> {
  const now = new Date().toISOString();
  const { data, error } = await db().from(TABLE)
    .update({ claimed_at: now, claimed_phone: phone })
    .eq("tenant_id", tenantId).eq("code", code).is("claimed_at", null).gt("expires_at", now)
    .select("*").maybeSingle();
  if (error || !data) return null;
  return map(data as unknown as Record<string, unknown>);
}

export async function setHandoffConversation(tenantId: string, id: string, conversationId: string): Promise<void> {
  await db().from(TABLE).update({ claimed_conversation_id: conversationId }).eq("tenant_id", tenantId).eq("id", id).then(() => {}, () => {});
}

/** What the contact keeps about where it came from. */
export function handoffAttributes(h: Handoff): Record<string, string> {
  const attrs: Record<string, string> = { came_from: `${PLATFORM_LABEL[h.platform]} ${h.sourceKind}` };
  if (h.sourceText) attrs.came_from_text = h.sourceText.slice(0, 500);
  if (h.postId) attrs.came_from_post = h.postId;
  if (h.sourceAuthor) attrs[`${h.platform}_handle`] = h.sourceAuthor;
  return attrs;
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface HandoffRow extends Handoff { orders: number; revenueCents: number }
export interface HandoffSummary { sent: number; started: number; orders: number; revenueCents: number }

const RANGES = [7, 30, 90, 365];
const PAGE = 25;

/** Paid orders from each claimed number since its chat started. */
async function ordersFor(tenantId: string, rows: Handoff[]): Promise<Map<string, { orders: number; revenueCents: number }>> {
  const out = new Map<string, { orders: number; revenueCents: number }>();
  const claimed = rows.filter(r => r.claimedPhone && r.claimedAt);
  if (!claimed.length) return out;
  const phones = [...new Set(claimed.map(r => r.claimedPhone as string))];
  const earliest = claimed.reduce((m, r) => (r.claimedAt! < m ? r.claimedAt! : m), claimed[0].claimedAt!);
  const { data } = await db().from("wa_orders").select("phone,total_cents,status,created_at")
    .eq("tenant_id", tenantId).in("phone", phones.slice(0, 500)).in("status", ["paid", "fulfilled"]).gte("created_at", earliest);
  const orders = (data ?? []) as { phone: string; total_cents: number; created_at: string }[];
  for (const r of claimed) {
    const mine = orders.filter(o => o.phone === r.claimedPhone && o.created_at >= r.claimedAt!);
    out.set(r.id, { orders: mine.length, revenueCents: mine.reduce((n, o) => n + (o.total_cents ?? 0), 0) });
  }
  return out;
}

/** One page of a platform's handoffs in the last `days`, with the range's totals on the first page. */
export async function listHandoffs(tenantId: string, q: { platform: HandoffPlatform; days?: number | null; cursor?: string | null }): Promise<{ rows: HandoffRow[]; next: string | null; summary?: HandoffSummary; setupNeeded?: string }> {
  const days = RANGES.includes(q.days as number) ? (q.days as number) : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [at, id] = (q.cursor ?? "").split("|");
  const cursorOk = !!at && !!id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/i.test(id);
  let query = tdb(tenantId).from(TABLE).select("*").eq("platform", q.platform).gte("created_at", since)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
  if (cursorOk) query = query.or(`created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${id})`);
  const { data, error } = await query;
  if (error) {
    if (/wa_handoffs|schema cache|does not exist/i.test(error.message)) return { rows: [], next: null, setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  const all = ((data ?? []) as unknown as Record<string, unknown>[]).map(map);
  const page = all.slice(0, PAGE);
  const sales = await ordersFor(tenantId, page);
  const rows = page.map(r => ({ ...r, ...(sales.get(r.id) ?? { orders: 0, revenueCents: 0 }) }));
  const last = page[page.length - 1];
  const next = all.length > PAGE && last ? `${last.createdAt}|${last.id}` : null;
  if (cursorOk) return { rows, next };

  // Range totals: counts in the database; sales over the range's claimed numbers.
  const head = (claimedOnly: boolean) => {
    let c = tdb(tenantId).from(TABLE).select("id", { count: "exact", head: true }).eq("platform", q.platform).gte("created_at", since);
    if (claimedOnly) c = c.not("claimed_at", "is", null);
    return c;
  };
  const [{ count: sent }, { count: started }, claimedRows] = await Promise.all([
    head(false), head(true),
    tdb(tenantId).from(TABLE).select("*").eq("platform", q.platform).gte("created_at", since).not("claimed_at", "is", null).limit(1000),
  ]);
  const claimed = ((claimedRows.data ?? []) as unknown as Record<string, unknown>[]).map(map);
  const totals = [...(await ordersFor(tenantId, claimed)).values()];
  return {
    rows, next,
    summary: { sent: sent ?? 0, started: started ?? 0, orders: totals.reduce((n, t) => n + t.orders, 0), revenueCents: totals.reduce((n, t) => n + t.revenueCents, 0) },
  };
}

// ── Rules ───────────────────────────────────────────────────────────────────

type InviteRule = { id: string; waHandoff: boolean; waHandoffMessage: string | null };
type InviteCtx = { tenantId: string; channelId: string | null; commentId?: string | null; postId?: string | null; text?: string | null; author?: string | null };

/**
 * The "Continue on WhatsApp" link for an Instagram/Facebook rule's DM. Null when
 * the option is off, the workspace has no WhatsApp number in Handle Hub, or the
 * handoff can't be stored — the DM then goes out without it.
 */
export async function ruleInviteLink(rule: InviteRule, platform: "instagram" | "facebook", ctx: InviteCtx): Promise<string | null> {
  if (!rule.waHandoff || !rule.waHandoffMessage?.trim()) return null;
  try {
    const num = await handoffNumber(ctx.tenantId);
    if (!num) return null;
    const h = await createHandoff({ tenantId: ctx.tenantId, platform, channelId: ctx.channelId, sourceRef: ctx.commentId, postId: ctx.postId, sourceText: ctx.text, sourceAuthor: ctx.author, ruleId: rule.id, message: rule.waHandoffMessage });
    return h ? handoffLink(num.number, h.code, num.greeting) : null;
  } catch { return null; }
}

/** A YouTube rule's reply with its WhatsApp code sentence, or unchanged when the option is off or the code can't be stored. */
export async function withYoutubeInvite(rule: InviteRule, reply: string, ctx: InviteCtx): Promise<string> {
  if (!rule.waHandoff || !rule.waHandoffMessage?.trim()) return reply;
  const h = await createHandoff({ tenantId: ctx.tenantId, platform: "youtube", channelId: ctx.channelId, sourceRef: ctx.commentId, postId: ctx.postId, sourceText: ctx.text, sourceAuthor: ctx.author, ruleId: rule.id, message: rule.waHandoffMessage }).catch(() => null);
  return h ? `${reply}\n\n${youtubeInvite(h.code)}` : reply;
}

export const INVITE_LABEL = "Continue on WhatsApp";   // 20 characters: Meta's button-title limit
/** The DM's link buttons with the invitation as the last one, inside Meta's 3-button cap. */
export function withInviteButton<B>(buttons: B[], link: string | null): B[] {
  return link ? [...buttons.slice(0, 2), { type: "web_url", url: link, title: INVITE_LABEL } as unknown as B] : buttons;
}
