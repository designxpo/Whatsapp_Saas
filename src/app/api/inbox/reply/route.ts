export const maxDuration = 30;
import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import {
  getConversation, getConversationByPhone, getOrCreateConversation,
  appendConvMessage, touchOutbound, setBotEnabled, isOptedOut,
} from "@/lib/store";
import { sendText, sendTemplateSingle } from "@/lib/whatsapp";
import { sendIgMessage } from "@/lib/instagram";
import { sendFbMessage } from "@/lib/messenger";
import { credsFor, getChannel } from "@/lib/channels";
import { errorMessage } from "@/lib/errors";
import { guardFeature, guardAccount } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// POST /api/inbox/reply — send a reply from the extension side-panel, on
// whichever channel the chat actually arrived on. Auth: Bearer <ak_live_… key>.
//
// Body: { conversationId? | phone?, name?, message?, templateName?, templateLang?,
//         templateParams?, agent?, pauseBot? }
//
// Routing MUST follow the conversation's platform: sending an Instagram reply
// down the WhatsApp API would log a message the customer never receives.
//   WhatsApp  — free-form inside Meta's 24h window, else an approved template.
//   Instagram — free-form inside its 24h window, or up to 7 days under Meta's
//               HUMAN_AGENT tag (a person is typing here, never the bot).
//   Facebook  — same as Instagram (Page messaging window).
//   Web chat  — no external API and no window; the reply is persisted and the
//               visitor's widget picks it up on its next poll.
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  const acctGate = await guardAccount(tenantId); if (acctGate) return acctGate;

  let body: {
    conversationId?: string; phone?: string; name?: string; message?: string;
    templateName?: string; templateLang?: string; templateParams?: string[];
    agent?: string; pauseBot?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const message = (body.message ?? "").trim();
  const templateName = (body.templateName ?? "").trim();
  if (!message && !templateName) return NextResponse.json({ error: "message or templateName required" }, { status: 400 });

  try {
    // Resolve the conversation (prefer the id the side-panel already has).
    let conv = body.conversationId ? await getConversation(body.conversationId, tenantId) : null;
    const phone = (body.phone ?? conv?.phone ?? "").replace(/\D/g, "");
    if (!conv && phone) conv = await getConversationByPhone(phone, tenantId);
    if (!conv) {
      if (!phone) return NextResponse.json({ error: "conversationId or phone required" }, { status: 400 });
      conv = await getOrCreateConversation(phone, body.name, null, "whatsapp", tenantId);
    }
    const platform = conv.platform ?? "whatsapp";

    // Opt-out suppression applies to the phone-identified channel.
    if (platform === "whatsapp" && await isOptedOut(conv.phone, tenantId)) {
      return NextResponse.json({ error: "Recipient has opted out", optedOut: true }, { status: 422 });
    }

    const windowOpen = !!conv.lastInboundAt && Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;
    let messageId: string | undefined;
    let logged = message;
    let sentAs: "text" | "template" = "text";

    if (platform === "instagram" || platform === "messenger") {
      // Templates are a WhatsApp-only concept — say so rather than silently
      // sending the template name as plain text.
      if (!message) {
        return NextResponse.json({ error: "Templates are WhatsApp-only. On this channel, send a normal message inside the 24-hour window." }, { status: 400 });
      }
      const ch = conv.channelId ? await getChannel(conv.channelId, tenantId) : null;
      if (platform === "instagram") {
        if (!ch?.igUserId || !ch?.token) return NextResponse.json({ error: "Instagram account not connected for this chat" }, { status: 502 });
        const sent = await sendIgMessage({ igUserId: ch.igUserId, token: ch.token }, conv.phone, message, { lastInboundAt: conv.lastInboundAt, humanAgent: true });
        if (!sent.ok) {
          const closed = sent.blockedBy === "window" || sent.blockedBy === "cold";
          return NextResponse.json(
            { error: sent.error || "Instagram send failed", window: closed ? "closed" : undefined, blockedBy: sent.blockedBy },
            { status: closed ? 422 : 502 },
          );
        }
        messageId = sent.messageId;
      } else {
        if (!ch?.pageId || !ch?.token) return NextResponse.json({ error: "Facebook Page not connected for this chat" }, { status: 502 });
        const sent = await sendFbMessage({ pageId: ch.pageId, token: ch.token }, conv.phone, message, { lastInboundAt: conv.lastInboundAt, humanAgent: true });
        if (!sent.ok) {
          const closed = sent.blockedBy === "window" || sent.blockedBy === "cold";
          return NextResponse.json(
            { error: sent.error || "Messenger send failed", window: closed ? "closed" : undefined, blockedBy: sent.blockedBy },
            { status: closed ? 422 : 502 },
          );
        }
        messageId = sent.messageId;
      }
    } else if (platform === "webchat") {
      if (!message) return NextResponse.json({ error: "Templates are WhatsApp-only. Send a normal message on web chat." }, { status: 400 });
      // Nothing to call — persisting below is the delivery mechanism.
    } else {
      if (windowOpen && message) {
        const channel = await credsFor(conv.channelId, tenantId);   // stay on the chat's number
        const sent = await sendText(conv.phone, message, channel);
        if (sent.error) return NextResponse.json({ error: sent.error, window: "open" }, { status: 502 });
        messageId = sent.id;
      } else if (templateName) {
        const channel = await credsFor(conv.channelId, tenantId);
        const sent = await sendTemplateSingle(conv.phone, templateName, body.templateLang || "en", body.templateParams ?? [], channel);
        if (sent.error) return NextResponse.json({ error: sent.error, window: windowOpen ? "open" : "closed" }, { status: 502 });
        messageId = sent.id;
        logged = `[template: ${templateName}]${(body.templateParams ?? []).length ? " " + (body.templateParams ?? []).join(" | ") : ""}`;
        sentAs = "template";
      } else {
        return NextResponse.json({
          error: "24h window closed — pass templateName (an approved template) to reach this lead",
          window: "closed",
        }, { status: 422 });
      }
    }

    const agentTag = (body.agent ?? "").trim();
    const threadBody = agentTag ? `${logged}\n— ${agentTag}` : logged;
    await appendConvMessage({ conversationId: conv.id, role: "assistant", body: threadBody, metaId: messageId, source: "agent", tenantId, channelId: conv.channelId ?? null });
    await touchOutbound(conv.id, logged);
    // A human is replying now — pause the AI bot unless told otherwise.
    if (body.pauseBot !== false && conv.botEnabled) await setBotEnabled(conv.id, false);

    return NextResponse.json({
      success: true,
      messageId,
      conversationId: conv.id,
      platform,
      window: platform === "webchat" ? "n/a" : windowOpen ? "open" : "closed",
      sentAs,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
