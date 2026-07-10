export const maxDuration = 180;   // runs an LLM reply (match the WhatsApp webhook so a slow turn isn't killed)
import { NextResponse, after } from "next/server";
import { getChannelBySiteKey } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, escalateConversation, getContactByPhone, setConversationLeadPhone, setConversationName, landCapturedLead, type Conversation } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { isAiEnabled } from "@/lib/messaging-settings";
import { handleFlowMessage, type WebchatOut } from "@/lib/flowengine";
import { pushChatActivity, phoneFromAttributes, extractPhone } from "@/lib/leadsquared";
import { corsHeaders, originAllowed, webchatConvId, verifyWidgetIdentity } from "@/lib/webchat";

const CLOSING_MSG = "Thanks! Our team will follow up with you shortly. 🙌";

// Mirror a web-chat message onto the lead's LeadSquared timeline. Website
// visitors have no phone, so the lead is matched by a phone shared in chat /
// captured by a flow. Never throws — CRM sync must not break the widget reply.
async function syncWebToLsq(conv: Conversation, body: string, direction: "inbound" | "outbound", via: "lead" | "bot" | "agent", tenantId: string) {
  try {
    const phone = conv.leadPhone || phoneFromAttributes((await getContactByPhone(conv.phone, tenantId).catch(() => null))?.attributes);
    if (!phone) return;   // no phone to match a CRM lead — skip
    await pushChatActivity({ phone, direction, body, via, channel: "Web chat", tenantId });
  } catch { /* CRM sync must never break web-chat handling */ }
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

// POST — a website visitor sends a message. Public + cross-origin: secured by the
// site key + the channel's origin allowlist. Persists the message, runs the AI
// (when the bot is on), and returns the reply inline so the widget shows it
// instantly; agent replies arrive via the poll endpoint.
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  let body: { siteKey?: string; visitorId?: string; text?: string; identity?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors }); }

  const siteKey = (body.siteKey ?? "").trim();
  const visitorId = (body.visitorId ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!siteKey || !visitorId || !text) return NextResponse.json({ error: "siteKey, visitorId and text are required" }, { status: 400, headers: cors });

  const channel = await getChannelBySiteKey(siteKey);
  if (!channel || !channel.active) return NextResponse.json({ error: "Unknown or inactive web-chat key" }, { status: 404, headers: cors });
  if (!originAllowed(origin, channel.allowedOrigins)) return NextResponse.json({ error: "Origin not allowed for this web-chat key" }, { status: 403, headers: cors });

  const tid = channel.tenantId;
  const id = webchatConvId(visitorId);
  // In-portal support chats carry a server-signed identity (workspace + user) —
  // the ticket shows "Acme Beauty · owner@acme.com" instead of "Website visitor".
  // Forged/unsigned payloads verify to null and change nothing; no other caller
  // input reaches the name (a spoofed name here would read as verified to the
  // support agent, so only the signed path may set it).
  const identity = verifyWidgetIdentity(body.identity, siteKey);
  const visitorName = identity ? `${identity.tenant}${identity.email ? ` · ${identity.email}` : ""}` : "Website visitor";
  let conv = await getOrCreateConversation(id, visitorName, channel.id, "webchat", tid);
  // Chats that predate the identity (or captured a casual name) upgrade to the
  // verified label — force outranks a non-generic existing name on purpose.
  if (identity && conv.name !== visitorName) {
    const renamed = await setConversationName(conv.phone, visitorName, tid, { force: true }).catch(() => false);
    if (renamed) conv = { ...conv, name: visitorName };
  }
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text.slice(0, 4000), source: "inbound", tenantId: tid });
  await touchInbound(conv.id, text.slice(0, 200));
  // Capture a phone the visitor types (web chat is anonymous) so the chat can be
  // matched to a CRM lead by phone — now and on later messages.
  if (!conv.leadPhone) {
    const shared = extractPhone(text);
    if (shared) {
      await setConversationLeadPhone(conv.id, shared).catch(() => undefined);
      conv = { ...conv, leadPhone: shared };
      // New number → a Contacts row tagged web-chat; a returning lead → their
      // existing contact gains the tag and this chat picks up their known name.
      await landCapturedLead(conv.phone, shared, "web-chat", tid);
    }
  }
  after(() => syncWebToLsq(conv, text, "inbound", "lead", tid));   // mirror to LeadSquared timeline

  // Human has taken over (bot off) or cap reached → no AI; the agent replies from
  // the Live Chat inbox and the widget picks it up via polling.
  if (!conv.botEnabled) return NextResponse.json({ ok: true }, { headers: cors });

  // Chatbot flow first (a flow targeting "webchat"/"all" whose keyword matches, or
  // an in-progress session). It runs synchronously and we return its messages —
  // text bubbles + tappable quick-reply chips — inline so the widget shows them at
  // once. If no flow handles the message, fall through to the AI reply below.
  const flowOut: WebchatOut[] = [];
  const flowHandled = await handleFlowMessage(conv.id, conv.phone, text, { channel, collector: flowOut, tenantId: tid }).catch(() => false);
  if (flowHandled && flowOut.length) {
    const at = flowOut[flowOut.length - 1]?.at;
    return NextResponse.json({ ok: true, messages: flowOut, reply: flowOut[0]?.body, at }, { headers: cors });
  }

  // Tenant-wide AI switch (Settings → AI auto-replies) — flows above still
  // answered; with the AI off, agents reply from the Live Chat inbox.
  if (!(await isAiEnabled(tid))) return NextResponse.json({ ok: true }, { headers: cors });

  const closeOut = async () => {
    const saved = await appendConvMessage({ conversationId: conv.id, role: "assistant", body: CLOSING_MSG, source: "bot", tenantId: tid });
    await touchOutbound(conv.id, CLOSING_MSG);
    await escalateConversation(conv.id);
    return NextResponse.json({ ok: true, reply: CLOSING_MSG, messages: [{ id: saved?.id, at: saved?.createdAt, body: CLOSING_MSG, from: "bot" }], escalated: true, id: saved?.id, at: saved?.createdAt }, { headers: cors });
  };
  // No reply cap on web-chat DMs: like the IG/Messenger DM paths (which only cap
  // public comment loops), a website chat is a real support/sales thread that
  // legitimately runs many turns — capping it muted the bot to a canned line
  // forever, which read exactly as "the bot stopped working". The AI keeps
  // answering; only a human (or a genuine model escalate below) hands it off.

  const history = await getConvHistory(conv.id, 20);
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body, mediaUrl: h.mediaUrl, mediaType: h.mediaType })), conv.phone, channel.agentId, tid, null, false);
  if (!r.reply || r.escalate) return closeOut();

  const saved = await appendConvMessage({ conversationId: conv.id, role: "assistant", body: r.reply, source: "bot", tenantId: tid });
  await touchOutbound(conv.id, r.reply);
  const aiReply = r.reply;   // capture (closure loses the non-null narrowing)
  after(() => syncWebToLsq(conv, aiReply, "outbound", "bot", tid));   // AI reply → LeadSquared
  // Return the saved message's id + timestamp so the widget seeds its dedup state
  // and the next poll won't re-render this same reply (the double-bubble bug).
  return NextResponse.json({ ok: true, reply: r.reply, messages: [{ id: saved?.id, at: saved?.createdAt, body: r.reply, from: "bot" }], id: saved?.id, at: saved?.createdAt }, { headers: cors });
}
