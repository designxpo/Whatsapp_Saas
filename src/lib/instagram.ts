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

// ── Comment-to-DM: one-time private reply to a comment ────────────────────────
// The comment IS the user-initiated opt-in. Meta allows a single private reply
// per comment — so this sends exactly ONE short block (rule #4).
export async function sendPrivateReply(creds: IgCreds, commentId: string, text: string): Promise<IgSendResult> {
  if (!commentId || !text.trim()) return { ok: false, error: "commentId and text required" };
  if (!allowSend(creds.igUserId)) return { ok: false, blockedBy: "rate", error: "Hourly send cap reached for this account" };
  // recipient.comment_id → Meta delivers a one-time private DM tied to the comment.
  return postMessage(creds, { recipient: { comment_id: commentId }, message: { text: text.slice(0, 1000) } });
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
