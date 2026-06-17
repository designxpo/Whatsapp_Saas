import { NextResponse } from "next/server";
import { crmAuthorized } from "@/lib/crm";
import { getConversationByPhone, getConvHistory } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";

// POST { phone } — an AI-drafted reply for the agent to review/edit (never sent).
// Grounded in the KB + this lead's conversation, same as the live assistant.
export async function POST(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const phone = (body.phone ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const conv = await getConversationByPhone(phone);
  if (!conv) return NextResponse.json({ error: "No conversation yet" }, { status: 404 });

  try {
    const history = await getConvHistory(conv.id, 20);
    const r = await generateReply(history.map(h => ({ role: h.role, body: h.body })), phone, conv.agentId, conv.tenantId, conv.primaryKbTag);
    return NextResponse.json({ suggestion: r.reply ?? "", escalate: r.escalate });
  } catch (err) {
    const msg = err instanceof AiKeyMissingError ? "AI isn't configured for this workspace." : "Could not draft a reply.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
