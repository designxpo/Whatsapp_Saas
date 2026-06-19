// Instagram Messaging — compliance-first sender.
//
// Built to NOT get accounts banned. Every rule Meta enforces for IG messaging
// is encoded here so no caller can bypass it:
//
//   1. Official Graph API only (no scraping / browser automation).
//   2. 24-HOUR WINDOW — a standard message may only be sent within 24h of the
//      user's LAST interaction. Outside it: blocked (unless a permitted tag,
//      which is intentionally NOT enabled by default).
//   3. NO COLD DMs — you can only message a user who messaged/commented first.
//      Enforced structurally: a send needs a recipient who already has an
//      inbound (lastInboundAt), or a comment_id (the comment is the opt-in).
//   4. COMMENT-TO-DM first message is a SINGLE short block (no multi-part
//      welcome) — sendPrivateReply sends exactly one message.
//   5. RATE PACING — soft cap per IG account to avoid spam/abuse flags.
//   6. Opt-out handled upstream (STOP) like WhatsApp.
//
// Requires the IG professional account id + an access token with
// instagram_manage_messages (obtained via Embedded Signup).

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
const WINDOW_MS = 24 * 60 * 60 * 1000;     // 24-hour standard messaging window
const MAX_PER_HOUR = 200;                  // conservative per-account pacing

export interface IgCreds {
  igUserId: string;   // IG professional account id
  token: string;      // access token with instagram_manage_messages
}

export interface IgSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  blockedBy?: "window" | "rate" | "cold";
}

// ── 24-hour window ────────────────────────────────────────────────────────────
// True only if the user interacted within the last 24h. No timestamp → false
// (which also blocks cold DMs structurally).
export function within24hWindow(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && Date.now() - t < WINDOW_MS;
}

// ── Rate pacing (best-effort, in-process) ─────────────────────────────────────
// Serverless instances don't share memory, so this is a soft guard; production
// should back it with a shared store (Redis/DB). It still curbs per-instance
// bursts that trip Meta's spam heuristics.
const sendTimes = new Map<string, number[]>();
function allowSend(igUserId: string): boolean {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const arr = (sendTimes.get(igUserId) ?? []).filter((t) => t > cutoff);
  if (arr.length >= MAX_PER_HOUR) { sendTimes.set(igUserId, arr); return false; }
  arr.push(now);
  sendTimes.set(igUserId, arr);
  return true;
}

async function postMessage(creds: IgCreds, payload: Record<string, unknown>): Promise<IgSendResult> {
  try {
    const r = await fetch(`${GRAPH}/${creds.igUserId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `IG send failed (${r.status})` };
    return { ok: true, messageId: j.message_id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "IG send error" };
  }
}

// Show a "typing…" indicator in the DM while we compose a reply (Messenger
// sender action). Best-effort — needs an open conversation; never blocks.
export async function sendTypingOn(creds: IgCreds, recipientIgsid: string): Promise<void> {
  if (!recipientIgsid) return;
  try { await postMessage(creds, { recipient: { id: recipientIgsid }, sender_action: "typing_on" }); }
  catch { /* best-effort */ }
}

// ── Standard DM (requires an open 24h window) ─────────────────────────────────
// `lastInboundAt` MUST be the user's last interaction time. Sends are refused
// outside the window and without prior interaction — never a cold DM.
export async function sendIgMessage(
  creds: IgCreds,
  recipientIgsid: string,
  text: string,
  opts: { lastInboundAt?: string | null } = {},
): Promise<IgSendResult> {
  if (!recipientIgsid || !text.trim()) return { ok: false, error: "recipient and text required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold",
             error: opts.lastInboundAt ? "Outside the 24-hour messaging window" : "No prior interaction — cold DMs are not allowed" };
  }
  if (!allowSend(creds.igUserId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this account" };
  return postMessage(creds, { recipient: { id: recipientIgsid }, message: { text: text.slice(0, 1000) } });
}

// Send a media attachment (image/video/audio) by public URL. Same 24h-window and
// rate rules as a text message. IG has no caption field on attachments, so any
// caption must be sent as a separate text message by the caller.
export async function sendIgMedia(
  creds: IgCreds,
  recipientIgsid: string,
  kind: "image" | "video" | "audio",
  url: string,
  opts: { lastInboundAt?: string | null } = {},
): Promise<IgSendResult> {
  if (!recipientIgsid || !url) return { ok: false, error: "recipient and media URL required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold", error: "Outside the 24-hour messaging window" };
  }
  if (!allowSend(creds.igUserId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this account" };
  return postMessage(creds, { recipient: { id: recipientIgsid }, message: { attachment: { type: kind, payload: { url } } } });
}

// Quick replies — tappable chips under a message (IG supports up to 13, titles
// ≤20 chars). Used by the flow engine so menu options are selectable, not just
// numbered text the user has to type back.
export interface IgQuickReply { title: string; payload: string }
export async function sendIgQuickReplies(
  creds: IgCreds,
  recipientIgsid: string,
  text: string,
  replies: IgQuickReply[],
  opts: { lastInboundAt?: string | null } = {},
): Promise<IgSendResult> {
  if (!recipientIgsid || !text.trim() || !replies.length) return { ok: false, error: "recipient, text and replies required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold", error: "Outside the 24-hour messaging window" };
  }
  if (!allowSend(creds.igUserId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this account" };
  const quick_replies = replies.slice(0, 13).map(r => ({
    content_type: "text",
    title: r.title.slice(0, 20),
    payload: (r.payload || r.title).slice(0, 1000),
  }));
  return postMessage(creds, { recipient: { id: recipientIgsid }, message: { text: text.slice(0, 1000), quick_replies } });
}

// Buttons usable in IG message/private-reply templates.
export type IgButton =
  | { type: "web_url"; url: string; title: string }
  | { type: "postback"; payload: string; title: string };

function buttonTemplate(text: string, buttons: IgButton[]) {
  return { attachment: { type: "template", payload: { template_type: "button", text: text.slice(0, 640), buttons: buttons.slice(0, 3) } } };
}
function buttonsAsText(text: string, buttons: IgButton[]): string {
  const links = buttons.filter((b): b is Extract<IgButton, { type: "web_url" }> => b.type === "web_url").map(b => `${b.title}: ${b.url}`);
  return [text, ...links].join("\n").slice(0, 1000);
}

// ── Comment-to-DM: one-time private reply to a comment ────────────────────────
// The comment IS the user-initiated opt-in. Meta allows a single private reply
// per comment — so this sends exactly ONE short block. Optionally attaches
// buttons (link and/or postback), with a plain-text fallback.
export async function sendPrivateReply(creds: IgCreds, commentId: string, text: string, buttons?: IgButton[] | null): Promise<IgSendResult> {
  if (!commentId || !text.trim()) return { ok: false, error: "commentId and text required" };
  if (!allowSend(creds.igUserId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this account" };
  const body = text.slice(0, 640);
  if (buttons && buttons.length) {
    const r = await postMessage(creds, { recipient: { comment_id: commentId }, message: buttonTemplate(body, buttons) });
    if (r.ok) return r;
    return postMessage(creds, { recipient: { comment_id: commentId }, message: { text: buttonsAsText(body, buttons) } });
  }
  return postMessage(creds, { recipient: { comment_id: commentId }, message: { text: body } });
}

// ── Standard DM with buttons (post-comment reward / re-prompt). Needs an open
// 24h window — the user's tap/message opens it.
export async function sendIgButtons(creds: IgCreds, recipientIgsid: string, text: string, buttons: IgButton[], opts: { lastInboundAt?: string | null } = {}): Promise<IgSendResult> {
  if (!recipientIgsid || !text.trim()) return { ok: false, error: "recipient and text required" };
  if (!within24hWindow(opts.lastInboundAt)) return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold", error: "Outside the 24-hour messaging window" };
  if (!allowSend(creds.igUserId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this account" };
  const r = await postMessage(creds, { recipient: { id: recipientIgsid }, message: buttonTemplate(text, buttons) });
  if (r.ok) return r;
  return postMessage(creds, { recipient: { id: recipientIgsid }, message: { text: buttonsAsText(text, buttons) } });
}

export interface IgProfile { name?: string; username?: string; profilePic?: string }

// Resolve a user's profile from their IGSID (webhooks only carry the id).
export async function getIgProfile(creds: IgCreds, igsid: string): Promise<IgProfile> {
  if (!igsid) return {};
  try {
    const r = await fetch(`${GRAPH}/${igsid}?fields=name,username,profile_pic`, { headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return {};
    return { name: j.name as string | undefined, username: j.username as string | undefined, profilePic: j.profile_pic as string | undefined };
  } catch { return {}; }
}

// Whether an IG user follows the business. true/false when Meta tells us
// (needs is_user_follow_business — Advanced Access + open conversation), else null.
export async function getFollowStatus(creds: IgCreds, igsid: string): Promise<boolean | null> {
  if (!igsid) return null;
  try {
    const r = await fetch(`${GRAPH}/${igsid}?fields=is_user_follow_business`, { headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
    const j = await r.json();
    if (!r.ok || typeof j.is_user_follow_business !== "boolean") return null;
    return j.is_user_follow_business as boolean;
  } catch { return null; }
}

export interface IgMedia { id: string; caption: string; permalink: string; thumbnail: string; mediaType: string; timestamp: string }

// List the account's recent posts for the rule post-picker. Best-effort.
export async function fetchIgMedia(creds: IgCreds, limit = 25): Promise<IgMedia[]> {
  if (!creds.igUserId) return [];
  try {
    const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
    const r = await fetch(`${GRAPH}/${creds.igUserId}/media?fields=${fields}&limit=${limit}`, { headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.data)) return [];
    return (j.data as Record<string, unknown>[]).map(m => ({
      id: String(m.id),
      caption: (m.caption as string) ?? "",
      permalink: (m.permalink as string) ?? "",
      thumbnail: (m.thumbnail_url as string) || (m.media_url as string) || "",
      mediaType: (m.media_type as string) ?? "",
      timestamp: (m.timestamp as string) ?? "",
    }));
  } catch { return []; }
}

// ── Public reply under a comment (optional, alongside the private DM) ─────────
export async function replyToComment(creds: IgCreds, commentId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!commentId || !text.trim()) return { ok: false, error: "commentId and text required" };
  try {
    const r = await fetch(`${GRAPH}/${commentId}/replies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.slice(0, 1000) }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Comment reply failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Comment reply error" };
  }
}
