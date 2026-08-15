import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { getConversation, getConversationByPhone, getConvHistory } from "@/lib/store";
import { getChannel, effectiveAgentId, effectiveKbTag } from "@/lib/channels";
import { generateReply } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call — must outlast Vercel's short default

// POST /api/inbox/suggest — an AI-drafted reply for the agent to review/edit
// (never auto-sent). Grounded in the KB + this lead's thread, same as the live
// assistant. Body: { conversationId? | phone? }. Auth: Bearer <ak_live_… key>.
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  let body: { conversationId?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const phone = (body.phone ?? "").replace(/\D/g, "");
  const conv = body.conversationId
    ? await getConversation(body.conversationId, tenantId)
    : phone ? await getConversationByPhone(phone, tenantId) : null;
  if (!conv) return NextResponse.json({ error: "No conversation yet" }, { status: 404 });

  try {
    const history = await getConvHistory(conv.id, 20, tenantId);
    // Match the live bot's resolution (conversation pin → channel default →
    // tenant-global) so the draft speaks with the same persona + knowledge.
    const channel = conv.channelId ? await getChannel(conv.channelId, tenantId) : null;
    const r = await generateReply(
      history.map(h => ({ role: h.role, body: h.body, mediaUrl: h.mediaUrl, mediaType: h.mediaType })),
      conv.phone, effectiveAgentId(conv, channel), tenantId, effectiveKbTag(conv, channel),
    );
    return NextResponse.json({ suggestion: r.reply ?? "", escalate: r.escalate });
  } catch (err) {
    const busy = err instanceof Error && /AI_BUSY/.test(err.message);
    const msg = err instanceof AiKeyMissingError ? "AI isn't configured for this workspace."
      : busy ? "AI is busy right now (model overloaded) — try again."
      : "Could not draft a reply.";
    return NextResponse.json({ error: msg }, { status: busy ? 503 : 500 });
  }
}
