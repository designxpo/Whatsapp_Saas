// Send a plain message from the team into a chat, on the channel it arrived on,
// and record it in the thread. For messages a person decided on — an approved
// or declined discount or refund (approvals.ts) — not for the AI's replies.
//
// Same rules as Live Chat and the extension's reply route:
//  - WhatsApp: free-form only inside Meta's 24-hour window (after it, only an
//    approved template may be sent — this helper says so instead of trying);
//  - Instagram / Messenger: their window, or Meta's HUMAN_AGENT tag, since a
//    person made this decision;
//  - web chat: no window; the widget picks the message up on its next poll.
// The AI stays on: the chat carries on as before after the decision.

import { appendConvMessage, touchOutbound, isOptedOut, type Conversation } from "./store";
import { sendText } from "./whatsapp";
import { sendIgMessage } from "./instagram";
import { sendFbMessage } from "./messenger";
import { credsFor, getChannel } from "./channels";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type TeamSendResult = { ok: true; messageId?: string } | { ok: false; error: string; windowClosed?: boolean };

/** Whether free text can reach this chat right now (before doing anything costly). */
export function canSendFreeText(conv: Pick<Conversation, "platform" | "lastInboundAt">, now = Date.now()): boolean {
  if (conv.platform !== "whatsapp") return true;   // IG/Messenger checked by their senders; web chat has no window
  return !!conv.lastInboundAt && now - Date.parse(conv.lastInboundAt) < WINDOW_MS;
}

export async function sendTeamText(conv: Conversation, message: string, actor: string): Promise<TeamSendResult> {
  const text = message.trim();
  if (!text) return { ok: false, error: "Write the message first." };
  const tenantId = conv.tenantId;
  let messageId: string | undefined;
  if (conv.platform === "instagram" || conv.platform === "messenger") {
    const ch = conv.channelId ? await getChannel(conv.channelId, tenantId) : null;
    const sent = conv.platform === "instagram"
      ? (ch?.igUserId && ch.token ? await sendIgMessage({ igUserId: ch.igUserId, token: ch.token }, conv.phone, text, { lastInboundAt: conv.lastInboundAt, humanAgent: true }) : null)
      : (ch?.pageId && ch.token ? await sendFbMessage({ pageId: ch.pageId, token: ch.token }, conv.phone, text, { lastInboundAt: conv.lastInboundAt, humanAgent: true }) : null);
    if (!sent) return { ok: false, error: `This ${conv.platform === "instagram" ? "Instagram account" : "Facebook Page"} isn't connected any more.` };
    if (!sent.ok) {
      const closed = sent.blockedBy === "window" || sent.blockedBy === "cold";
      return { ok: false, error: closed ? "Meta's messaging window for this chat has closed, so the message can't be sent now." : (sent.error || "The message couldn't be sent."), windowClosed: closed };
    }
    messageId = sent.messageId;
  } else if (conv.platform === "whatsapp") {
    if (await isOptedOut(conv.phone, tenantId)) return { ok: false, error: "This customer opted out of messages." };
    if (!canSendFreeText(conv)) return { ok: false, error: "WhatsApp's 24-hour window has closed — only an approved template can reach this customer now.", windowClosed: true };
    const sent = await sendText(conv.phone, text, await credsFor(conv.channelId, tenantId));
    if (sent.error) return { ok: false, error: sent.error };
    messageId = sent.id;
  }
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `${text}\n— ${actor}`, metaId: messageId, source: "agent", tenantId, channelId: conv.channelId ?? null });
  await touchOutbound(conv.id, text);
  return { ok: true, messageId };
}
