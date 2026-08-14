// Facebook Messenger — compliance-first sender.
//
// Structurally identical to instagram.ts (both use Meta's Graph `/{id}/messages`
// Send API), with the Page id + Page access token instead of the IG account id:
//
//   1. Official Graph API only.
//   2. 24-HOUR WINDOW — a standard message may only be sent within 24h of the
//      user's last interaction. Outside it: blocked (message tags intentionally
//      NOT enabled by default, to stay within Meta policy).
//   3. NO COLD messages — a send needs a recipient who messaged first (we only
//      ever have a PSID after the user has messaged the Page).
//   4. RATE PACING — soft per-Page cap to avoid spam/abuse flags.
//   5. Opt-out (STOP) handled upstream like WhatsApp/Instagram.
//
// Requires the Facebook Page id + a Page access token with pages_messaging
// (obtained via Embedded Signup / Page connect).

import { moderateText } from "./moderation";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
const WINDOW_MS = 24 * 60 * 60 * 1000;     // 24-hour standard messaging window
const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // HUMAN_AGENT tag: 7 days
const MAX_PER_HOUR = 250;                  // conservative per-Page DM pacing
const MAX_COMMENT_REPLIES_PER_HOUR = 60;   // public comment replies — Meta is stricter here
const MAX_COMMENT_LIKES_PER_HOUR = 100;    // liking commenters' comments (light engagement)

export interface FbCreds {
  pageId: string;   // connected Facebook Page id
  token: string;    // Page access token with pages_messaging
}

export interface FbSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  blockedBy?: "window" | "rate" | "cold";
}

// ── 24-hour window ────────────────────────────────────────────────────────────
// True only if the user interacted within the last 24h. No timestamp → false
// (which also blocks cold messages structurally).
export function within24hWindow(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && Date.now() - t < WINDOW_MS;
}

// ── Human-agent window (7 days) ───────────────────────────────────────────────
// Meta lets a HUMAN agent — not automation — answer for 7 days past the standard
// 24h, via messaging_type MESSAGE_TAG + tag HUMAN_AGENT. Bots must NEVER use it:
// the tag asserts a person is typing.
export function withinHumanAgentWindow(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && Date.now() - t < HUMAN_AGENT_WINDOW_MS;
}

function withHumanAgentTag(payload: Record<string, unknown>, lastInboundAt: string | null | undefined, humanAgent: boolean): Record<string, unknown> {
  if (!humanAgent || within24hWindow(lastInboundAt)) return payload;
  return { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
}

// ── Rate pacing (best-effort, in-process) ─────────────────────────────────────
// Serverless instances don't share memory, so this is a soft per-instance guard;
// it still curbs bursts that trip Meta's spam heuristics.
const sendTimes = new Map<string, number[]>();
// Keyed by "<kind>:<pageId>" so DMs and public comment replies are paced on
// SEPARATE budgets (a comment-reply burst must not starve DMs, or vice-versa).
function withinRate(key: string, max: number): boolean {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const arr = (sendTimes.get(key) ?? []).filter((t) => t > cutoff);
  if (arr.length >= max) { sendTimes.set(key, arr); return false; }
  arr.push(now);
  sendTimes.set(key, arr);
  return true;
}
function allowSend(pageId: string): boolean { return withinRate(`dm:${pageId}`, MAX_PER_HOUR); }

async function postMessage(creds: FbCreds, payload: Record<string, unknown>): Promise<FbSendResult> {
  try {
    const r = await fetch(`${GRAPH}/${creds.pageId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Messenger send failed (${r.status})` };
    return { ok: true, messageId: j.message_id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Messenger send error" };
  }
}

// Show a "typing…" indicator while we compose a reply. Best-effort; never blocks.
export async function sendTypingOn(creds: FbCreds, recipientPsid: string): Promise<void> {
  if (!recipientPsid) return;
  try { await postMessage(creds, { recipient: { id: recipientPsid }, sender_action: "typing_on" }); }
  catch { /* best-effort */ }
}

// ── Standard message (requires an open 24h window) ────────────────────────────
// `lastInboundAt` MUST be the user's last interaction time. Sends are refused
// outside the window and without prior interaction — never a cold message.
export async function sendFbMessage(
  creds: FbCreds,
  recipientPsid: string,
  text: string,
  opts: { lastInboundAt?: string | null; humanAgent?: boolean } = {},
): Promise<FbSendResult> {
  if (!recipientPsid || !text.trim()) return { ok: false, error: "recipient and text required" };
  // A person replying by hand gets Meta's 7-day human-agent allowance; anything
  // automated stays inside the strict 24h window.
  const allowed = opts.humanAgent ? withinHumanAgentWindow(opts.lastInboundAt) : within24hWindow(opts.lastInboundAt);
  if (!allowed) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold",
             error: opts.lastInboundAt
               ? (opts.humanAgent ? "Outside the 7-day human-agent window" : "Outside the 24-hour messaging window")
               : "No prior interaction — cold messages are not allowed" };
  }
  if (!allowSend(creds.pageId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this Page" };
  // Last-line content check — the single funnel for Messenger DM text, so it
  // covers AI replies, flow steps and agent-typed Live Chat messages alike.
  if (!(await moderateText(text, { surface: "dm_reply" })).allowed) {
    return { ok: false, error: "Blocked by the content safety filter" };
  }
  return postMessage(creds, withHumanAgentTag(
    { recipient: { id: recipientPsid }, message: { text: text.slice(0, 2000) } },
    opts.lastInboundAt, !!opts.humanAgent,
  ));
}

// Send a media attachment (image/video/audio) by public URL. Same window + rate
// rules. Messenger has no caption field on attachments — send any caption as a
// separate text message by the caller.
export async function sendFbMedia(
  creds: FbCreds,
  recipientPsid: string,
  kind: "image" | "video" | "audio",
  url: string,
  opts: { lastInboundAt?: string | null } = {},
): Promise<FbSendResult> {
  if (!recipientPsid || !url) return { ok: false, error: "recipient and media URL required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold", error: "Outside the 24-hour messaging window" };
  }
  if (!allowSend(creds.pageId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this Page" };
  return postMessage(creds, { recipient: { id: recipientPsid }, message: { attachment: { type: kind, payload: { url, is_reusable: true } } } });
}

// Quick replies — tappable chips under a message (Messenger supports up to 13,
// titles ≤20 chars). Used by the inbox so menu options are selectable.
export interface FbQuickReply { title: string; payload: string }
export async function sendFbQuickReplies(
  creds: FbCreds,
  recipientPsid: string,
  text: string,
  replies: FbQuickReply[],
  opts: { lastInboundAt?: string | null } = {},
): Promise<FbSendResult> {
  if (!recipientPsid || !text.trim() || !replies.length) return { ok: false, error: "recipient, text and replies required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold", error: "Outside the 24-hour messaging window" };
  }
  if (!allowSend(creds.pageId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this Page" };
  // Body + every quick-reply label are all customer-visible.
  if (!(await moderateText([text, ...replies.map(r => r.title)].join("\n"), { surface: "dm_reply" })).allowed) {
    return { ok: false, error: "Blocked by the content safety filter" };
  }
  const quick_replies = replies.slice(0, 13).map(r => ({
    content_type: "text",
    title: r.title.slice(0, 20),
    payload: (r.payload || r.title).slice(0, 1000),
  }));
  return postMessage(creds, { recipient: { id: recipientPsid }, message: { text: text.slice(0, 2000), quick_replies } });
}

// Buttons usable in Messenger message / private-reply templates.
export type FbButton =
  | { type: "web_url"; url: string; title: string }
  | { type: "postback"; payload: string; title: string };

function buttonTemplate(text: string, buttons: FbButton[]) {
  return { attachment: { type: "template", payload: { template_type: "button", text: text.slice(0, 640), buttons: buttons.slice(0, 3) } } };
}
// Plain-text fallback when a button template is rejected — keeps any links usable.
function buttonsAsText(text: string, buttons: FbButton[]): string {
  const links = buttons.filter((b): b is Extract<FbButton, { type: "web_url" }> => b.type === "web_url").map(b => `${b.title}: ${b.url}`);
  return [text, ...links].join("\n").slice(0, 2000);
}

// ── Comment-to-DM: one-time private reply to a Page comment ────────────────────
// Meta allows ONE private reply per comment (the comment is the opt-in), sendable
// for up to 7 days — so no 24h-window check here. Optional buttons (link/postback)
// with a plain-text fallback if the button template is rejected.
export async function sendFbPrivateReply(
  creds: FbCreds,
  commentId: string,
  text: string,
  buttons?: FbButton[] | null,
  tenantId?: string,
): Promise<FbSendResult> {
  if (!commentId || !text.trim()) return { ok: false, error: "commentId and text required" };
  if (!allowSend(creds.pageId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this Page" };
  // Last-line safety check before anything leaves under the shared Meta app —
  // covers rule-configured DM text as well as AI-generated text.
  if (!(await moderateText(text, { tenantId, surface: "dm_reply" })).allowed) {
    return { ok: false, error: "Blocked by the content safety filter" };
  }
  const body = text.slice(0, 640);
  if (buttons && buttons.length) {
    const r = await postMessage(creds, { recipient: { comment_id: commentId }, message: buttonTemplate(body, buttons) });
    if (r.ok) return r;
    return postMessage(creds, { recipient: { comment_id: commentId }, message: { text: buttonsAsText(body, buttons) } });
  }
  return postMessage(creds, { recipient: { comment_id: commentId }, message: { text: body } });
}

// Standard DM with buttons (used after the comment, e.g. an unlocked reward).
// Requires an open 24h window — the user's tap/message opens it.
export async function sendFbButtons(
  creds: FbCreds,
  recipientPsid: string,
  text: string,
  buttons: FbButton[],
  opts: { lastInboundAt?: string | null } = {},
): Promise<FbSendResult> {
  if (!recipientPsid || !text.trim()) return { ok: false, error: "recipient and text required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold", error: "Outside the 24-hour messaging window" };
  }
  if (!allowSend(creds.pageId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this Page" };
  const r = await postMessage(creds, { recipient: { id: recipientPsid }, message: buttonTemplate(text, buttons) });
  if (r.ok) return r;
  return postMessage(creds, { recipient: { id: recipientPsid }, message: { text: buttonsAsText(text, buttons) } });
}

// ── Public reply under a Page comment (optional) ──────────────────────────────
export async function replyToFbComment(creds: FbCreds, commentId: string, text: string, tenantId?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!commentId || !text.trim()) return { ok: false, error: "commentId and text required" };
  // Pace public replies on their own budget — unbounded identical/rapid replies
  // are the fastest way to get a Page action-blocked.
  if (!withinRate(`comment:${creds.pageId}`, MAX_COMMENT_REPLIES_PER_HOUR)) {
    return { ok: false, error: "Hourly comment-reply cap reached for this Page" };
  }
  // Public replies carry the most policy risk (visible, under the shared app).
  if (!(await moderateText(text, { tenantId, surface: "comment_reply" })).allowed) {
    return { ok: false, error: "Blocked by the content safety filter" };
  }
  try {
    const r = await fetch(`${GRAPH}/${commentId}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.slice(0, 2000) }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Comment reply failed (${r.status})` };
    return { ok: true, id: (j.id as string) ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Comment reply error" };
  }
}

// Like a Page comment AS the Page. Best-effort engagement signal on comments an
// automation replies to. Paced on its own budget to avoid spam flags. Needs the
// Page token's pages_manage_engagement permission.
export async function likeFbComment(creds: FbCreds, commentId: string): Promise<{ ok: boolean; error?: string }> {
  if (!commentId) return { ok: false, error: "commentId required" };
  if (!withinRate(`like:${creds.pageId}`, MAX_COMMENT_LIKES_PER_HOUR)) {
    return { ok: false, error: "Hourly comment-like cap reached for this Page" };
  }
  try {
    const r = await fetch(`${GRAPH}/${commentId}/likes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Comment like failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Comment like error" };
  }
}

export interface FbMedia { id: string; caption: string; permalink: string; thumbnail: string; mediaType: string; timestamp: string }

// List the Page's recent posts so the UI can offer a post picker for
// comment-automation rules. Best-effort; returns [] on any error. The post id is
// the {pageId}_{postId} form, which matches the webhook's post_id for targeting.
export async function fetchFbPosts(creds: FbCreds, limit = 25): Promise<FbMedia[]> {
  if (!creds.pageId) return [];
  try {
    const fields = "id,message,full_picture,permalink_url,created_time,status_type";
    const r = await fetch(`${GRAPH}/${creds.pageId}/posts?fields=${fields}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.data)) return [];
    return (j.data as Record<string, unknown>[]).map(m => ({
      id: String(m.id),
      caption: (m.message as string) ?? "",
      permalink: (m.permalink_url as string) ?? "",
      thumbnail: (m.full_picture as string) ?? "",
      mediaType: (m.status_type as string) ?? "",
      timestamp: (m.created_time as string) ?? "",
    }));
  } catch {
    return [];
  }
}

export interface FbProfile { name?: string; profilePic?: string }

// Resolve a user's profile from their PSID (webhooks only carry the id). Works
// with a Page access token that has pages_messaging + an open conversation.
export async function getFbProfile(creds: FbCreds, psid: string): Promise<FbProfile> {
  if (!psid) return {};
  try {
    const r = await fetch(`${GRAPH}/${psid}?fields=name,profile_pic`, { headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return {};
    return { name: j.name as string | undefined, profilePic: j.profile_pic as string | undefined };
  } catch { return {}; }
}
