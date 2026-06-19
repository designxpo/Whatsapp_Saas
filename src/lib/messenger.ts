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

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
const WINDOW_MS = 24 * 60 * 60 * 1000;     // 24-hour standard messaging window
const MAX_PER_HOUR = 250;                  // conservative per-Page pacing

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

// ── Rate pacing (best-effort, in-process) ─────────────────────────────────────
// Serverless instances don't share memory, so this is a soft per-instance guard;
// it still curbs bursts that trip Meta's spam heuristics.
const sendTimes = new Map<string, number[]>();
function allowSend(pageId: string): boolean {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const arr = (sendTimes.get(pageId) ?? []).filter((t) => t > cutoff);
  if (arr.length >= MAX_PER_HOUR) { sendTimes.set(pageId, arr); return false; }
  arr.push(now);
  sendTimes.set(pageId, arr);
  return true;
}

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
  opts: { lastInboundAt?: string | null } = {},
): Promise<FbSendResult> {
  if (!recipientPsid || !text.trim()) return { ok: false, error: "recipient and text required" };
  if (!within24hWindow(opts.lastInboundAt)) {
    return { ok: false, blockedBy: opts.lastInboundAt ? "window" : "cold",
             error: opts.lastInboundAt ? "Outside the 24-hour messaging window" : "No prior interaction — cold messages are not allowed" };
  }
  if (!allowSend(creds.pageId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this Page" };
  return postMessage(creds, { recipient: { id: recipientPsid }, message: { text: text.slice(0, 2000) } });
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
  const quick_replies = replies.slice(0, 13).map(r => ({
    content_type: "text",
    title: r.title.slice(0, 20),
    payload: (r.payload || r.title).slice(0, 1000),
  }));
  return postMessage(creds, { recipient: { id: recipientPsid }, message: { text: text.slice(0, 2000), quick_replies } });
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
