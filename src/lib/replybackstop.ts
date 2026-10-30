// The safety net for AI replies on Instagram, Messenger and the website chat.
//
// Those three answer inline — inside their webhook, or the widget's own
// request. When that attempt failed (the model timed out, the function was
// killed at its time limit, anything threw), the lead was left in silence:
// the cron's awaiting-reply sweep only knew how to answer on WhatsApp — and,
// before the platform guard in assistant.ts, tried to, sending an AI reply
// meant for an Instagram chat to WhatsApp every minute.
//
// This is the sweep's answer for them. The rules:
//  - Only once the inline attempt is certainly over: the customer's last
//    message must be older than the webhooks' own time limit, plus a margin.
//    Until then an inline reply may still land, and two would go out.
//  - ONE attempt per unanswered message. If anything from us already follows
//    the customer's last message — a reply, or a "not delivered" note — it is
//    left alone. A failure here leaves a note too, and keeps the chat flagged
//    for a person. Never a retry every minute for a day.
//  - What the inline path deliberately leaves unanswered stays unanswered:
//    comment threads (answered in public, never by DM), a chat a sequence or
//    a chatbot flow is driving, an opted-out person, a bot switched off, an
//    Instagram or Messenger message with no text (an agent answers those).
//  - The same call as inline — the chat's persona, knowledge scope and, for a
//    DM, the commerce context the AI may act in — delivered the channel's own
//    way. Website chat has nothing to send: the reply is added to the chat and
//    the widget's poll shows it.
//  - Every read and write names the conversation's own business.

import { getConversation, getConvHistory, appendConvMessage, touchOutbound, escalateConversation, claimReply, reflagReply, optoutSet, logSendFailure, type Conversation } from "./store";
import { getChannel, effectiveAgentId, effectiveKbScope, type Channel } from "./channels";
import { generateReply } from "./llm";
import { isAiEnabled } from "./messaging-settings";
import { hasActiveDripEnrollment } from "./sequences";
import { inFlow } from "./flowengine";
import { sendIgMessage } from "./instagram";
import { sendFbMessage } from "./messenger";

/** The webhooks' own time limit (maxDuration 180 on all three routes). */
export const INLINE_LIMIT_MS = 180_000;
/** Older than this, the inline attempt is over — finished or killed. */
export const SETTLE_MS = INLINE_LIMIT_MS + 30_000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

const PLATFORMS = ["instagram", "messenger", "webchat"] as const;
type Platform = (typeof PLATFORMS)[number];

// The hand-off line each inline path sends when the model escalates.
const CLOSING: Record<Platform, string> = {
  instagram: "Thanks for reaching out! 🙌 Our team will connect with you shortly.",
  messenger: "Thanks for reaching out! 🙌 Our team will connect with you shortly.",
  webchat: "Thanks! Our team will follow up with you shortly. 🙌",
};

export type BackstopOutcome = "sent" | "escalated" | "skipped" | "failed";

type Msg = { role: string; body: string; mediaUrl?: string | null; mediaType?: string | null };

/**
 * Whether the safety net may answer this chat now — everything that can be
 * decided without a database call. Pure, so each rule is pinned by a test.
 */
export function backstopDecision(conv: Pick<Conversation, "platform" | "botEnabled" | "status" | "isComment" | "lastInboundAt">, history: Msg[], now = Date.now()): { ok: true } | { ok: false; why: string } {
  if (!(PLATFORMS as readonly string[]).includes(conv.platform)) return { ok: false, why: "answered by its own sweep" };
  if (!conv.botEnabled || conv.status === "paused") return { ok: false, why: "bot off for this chat" };
  if (conv.isComment) return { ok: false, why: "comment thread — answered in public, never by DM" };
  if (!conv.lastInboundAt) return { ok: false, why: "nothing to answer" };
  const age = now - new Date(conv.lastInboundAt).getTime();
  if (age < SETTLE_MS) return { ok: false, why: "inline reply may still be running" };
  if (age > WINDOW_MS) return { ok: false, why: "outside the 24-hour window" };
  const last = history[history.length - 1];
  if (!last || last.role !== "user") return { ok: false, why: "already answered or attempted" };
  if (conv.platform !== "webchat" && !last.body.trim()) return { ok: false, why: "no text — an agent answers media" };
  return { ok: true };
}

/** Answer one unanswered Instagram, Messenger or website chat, if it should be. */
export async function answerUnanswered(conversationId: string, now = Date.now()): Promise<{ outcome: BackstopOutcome; detail?: string }> {
  const conv = await getConversation(conversationId);
  if (!conv) return { outcome: "skipped", detail: "no conversation" };
  if (process.env.LLM_BOT_ENABLED === "false") return { outcome: "skipped", detail: "bot disabled" };
  const tid = conv.tenantId;

  const history = await getConvHistory(conversationId, 20, tid);
  const decision = backstopDecision(conv, history, now);
  if (!decision.ok) return { outcome: "skipped", detail: decision.why };

  if (!(await isAiEnabled(tid))) return { outcome: "skipped", detail: "AI replies switched off" };
  // The same suppression the webhooks apply (they key opt-outs by the id's last 10).
  if ((await optoutSet(tid)).has(conv.phone.slice(-10))) return { outcome: "skipped", detail: "opted out" };
  if (await hasActiveDripEnrollment(conv.phone, tid)) return { outcome: "skipped", detail: "in active sequence" };
  if (await inFlow(conv.id, tid)) return { outcome: "skipped", detail: "a chatbot flow is mid-conversation" };
  const channel = conv.channelId ? await getChannel(conv.channelId, tid) : null;
  if (!channel) return { outcome: "skipped", detail: "channel not found" };

  // Only one runner answers — and, having claimed it, this one must leave the
  // chat flagged for a person if it does not answer.
  if (!(await claimReply(conversationId))) return { outcome: "skipped", detail: "already claimed" };

  const platform = conv.platform as Platform;
  try {
    const r = await generateReply(
      history.map(h => ({ role: h.role, body: h.body.replace(/^\[comment\] /, ""), mediaUrl: h.mediaUrl, mediaType: h.mediaType })),
      conv.phone, effectiveAgentId(conv, channel), tid, effectiveKbScope(conv, channel),
      platform === "instagram" && !conv.leadPhone,
      platform === "webchat" ? undefined : { platform, conversationId: conv.id },
      platform, undefined, { canAct: true },
    );
    if (!r.reply || r.escalate) {
      await deliver(platform, channel, conv, CLOSING[platform]);
      await escalateConversation(conv.id);
      return { outcome: "escalated", detail: "model handed it to a person" };
    }
    if (!(await deliver(platform, channel, conv, r.reply))) {
      await reflagReply(conv.id);
      return { outcome: "failed", detail: "not delivered" };
    }
    return { outcome: "sent" };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // Visible in Live Chat, and it marks this message as attempted.
    await logSendFailure(conv.id, channel.id, `the AI could not answer (${why.slice(0, 160)})`, tid);
    await reflagReply(conv.id);
    return { outcome: "failed", detail: why };
  }
}

/**
 * Send `text` the channel's way and record it. A failed send is recorded as
 * a visible note (which also marks the message as attempted).
 */
async function deliver(platform: Platform, channel: Channel, conv: Conversation, text: string): Promise<boolean> {
  if (platform !== "webchat") {
    const r = platform === "instagram"
      ? await sendIgMessage({ igUserId: channel.igUserId ?? "", token: channel.token }, conv.phone, text, { lastInboundAt: conv.lastInboundAt })
      : await sendFbMessage({ pageId: channel.pageId ?? "", token: channel.token }, conv.phone, text, { lastInboundAt: conv.lastInboundAt });
    if (!r.ok) {
      await logSendFailure(conv.id, channel.id, r.error || "unknown error", conv.tenantId);
      return false;
    }
  }
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: text, source: "bot", channelId: channel.id, tenantId: conv.tenantId });
  await touchOutbound(conv.id, text);
  return true;
}
