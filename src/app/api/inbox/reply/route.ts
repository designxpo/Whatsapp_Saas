export const maxDuration = 30;
import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import {
  getConversation, getConversationByPhone, getOrCreateConversation,
  appendConvMessage, touchOutbound, setBotEnabled, isOptedOut,
} from "@/lib/store";
import { sendText, sendTemplateSingle } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// POST /api/inbox/reply — send a WhatsApp reply from the extension side-panel.
// Body: { conversationId? | phone?, name?, message?, templateName?, templateLang?,
//         templateParams?, agent?, pauseBot? }
// Inside the 24h window → free-form `message`. Outside → `templateName` required.
// Auth: Authorization: Bearer <ak_live_… key>. Honours opt-outs.
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    // Only WhatsApp is sendable here (Cloud API). Instagram/Messenger/webchat
    // replies go through their own channels — reject rather than mis-send.
    if (conv.platform && conv.platform !== "whatsapp") {
      return NextResponse.json({ error: "This endpoint sends WhatsApp replies only.", platform: conv.platform }, { status: 422 });
    }
    if (await isOptedOut(conv.phone, tenantId)) {
      return NextResponse.json({ error: "Recipient has opted out", optedOut: true }, { status: 422 });
    }

    const channel = await credsFor(conv.channelId, tenantId);   // stay on the chat's number
    const windowOpen = !!conv.lastInboundAt && Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;

    let sent: { id?: string; error?: string };
    let logged: string;
    if (windowOpen && message) {
      sent = await sendText(conv.phone, message, channel);
      logged = message;
    } else if (templateName) {
      sent = await sendTemplateSingle(conv.phone, templateName, body.templateLang || "en", body.templateParams ?? [], channel);
      logged = `[template: ${templateName}]${(body.templateParams ?? []).length ? " " + (body.templateParams ?? []).join(" | ") : ""}`;
    } else {
      return NextResponse.json({
        error: "24h window closed — pass templateName (an approved template) to reach this lead",
        window: "closed",
      }, { status: 422 });
    }
    if (sent.error) return NextResponse.json({ error: sent.error, window: windowOpen ? "open" : "closed" }, { status: 502 });

    const agentTag = (body.agent ?? "").trim();
    const threadBody = agentTag ? `${logged}\n— ${agentTag}` : logged;
    await appendConvMessage({ conversationId: conv.id, role: "assistant", body: threadBody, metaId: sent.id, source: "agent", tenantId, channelId: conv.channelId ?? null });
    await touchOutbound(conv.id, logged);
    // A human is replying now — pause the AI bot unless told otherwise.
    if (body.pauseBot !== false && conv.botEnabled) await setBotEnabled(conv.id, false);

    return NextResponse.json({
      success: true,
      messageId: sent.id,
      conversationId: conv.id,
      window: windowOpen ? "open" : "closed",
      sentAs: windowOpen && message ? "text" : "template",
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
