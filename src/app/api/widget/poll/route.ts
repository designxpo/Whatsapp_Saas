import { NextResponse } from "next/server";
import { getChannelBySiteKey } from "@/lib/channels";
import { getConversationByExactPhone, getConvMessagesSince } from "@/lib/store";
import { corsHeaders, originAllowed, webchatConvId } from "@/lib/webchat";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

// GET — the widget polls for new messages (agent replies, and AI replies it
// didn't already receive inline). Public + cross-origin; secured by the site key
// + origin allowlist. ?since=<ISO> returns only messages after that timestamp.
export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const url = new URL(req.url);
  const siteKey = (url.searchParams.get("siteKey") ?? "").trim();
  const visitorId = (url.searchParams.get("visitorId") ?? "").trim();
  const since = url.searchParams.get("since");
  if (!siteKey || !visitorId) return NextResponse.json({ error: "siteKey and visitorId required" }, { status: 400, headers: cors });

  const channel = await getChannelBySiteKey(siteKey);
  if (!channel || !channel.active) return NextResponse.json({ error: "Unknown or inactive web-chat key" }, { status: 404, headers: cors });
  if (!originAllowed(origin, channel.allowedOrigins)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: cors });

  const conv = await getConversationByExactPhone(webchatConvId(visitorId), channel.tenantId);
  if (!conv) return NextResponse.json({ messages: [] }, { headers: cors });

  const rows = await getConvMessagesSince(conv.id, since, channel.tenantId);
  // Only the assistant/agent side is interesting to the widget (it already shows
  // the visitor's own messages); strip internal markers.
  const messages = rows
    .filter(m => m.role === "assistant")
    .map(m => ({ id: m.id, body: m.body, at: m.createdAt, from: m.source === "agent" ? "agent" : "bot", mediaUrl: m.mediaUrl ?? null }));
  return NextResponse.json({ messages, status: conv.status }, { headers: cors });
}
