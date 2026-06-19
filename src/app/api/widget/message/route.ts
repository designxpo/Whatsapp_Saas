export const maxDuration = 60;   // runs an LLM reply
import { NextResponse } from "next/server";
import { getChannelBySiteKey } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, escalateConversation } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { corsHeaders, originAllowed, webchatConvId } from "@/lib/webchat";

const AI_REPLY_CAP = 8;   // safety cap before handing the chat to a human
const CLOSING_MSG = "Thanks! Our team will follow up with you shortly. 🙌";

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
  let body: { siteKey?: string; visitorId?: string; text?: string; name?: string };
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
  const conv = await getOrCreateConversation(id, (body.name ?? "").trim() || "Website visitor", channel.id, "webchat", tid);
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text.slice(0, 4000), source: "inbound", tenantId: tid });
  await touchInbound(conv.id, text.slice(0, 200));

  // Human has taken over (bot off) or cap reached → no AI; the agent replies from
  // the Live Chat inbox and the widget picks it up via polling.
  if (!conv.botEnabled) return NextResponse.json({ ok: true }, { headers: cors });

  const closeOut = async () => {
    await appendConvMessage({ conversationId: conv.id, role: "assistant", body: CLOSING_MSG, source: "bot", tenantId: tid });
    await touchOutbound(conv.id, CLOSING_MSG);
    await escalateConversation(conv.id);
    return NextResponse.json({ ok: true, reply: CLOSING_MSG, escalated: true }, { headers: cors });
  };
  if (conv.aiReplyCount >= AI_REPLY_CAP) return closeOut();

  const history = await getConvHistory(conv.id, 20);
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body })), conv.phone, channel.agentId, tid, null, false);
  if (!r.reply || r.escalate) return closeOut();

  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: r.reply, source: "bot", tenantId: tid });
  await touchOutbound(conv.id, r.reply);
  return NextResponse.json({ ok: true, reply: r.reply }, { headers: cors });
}
