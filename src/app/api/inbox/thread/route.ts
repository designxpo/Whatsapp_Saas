import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { getConversation, getConversationByPhone, getConvHistory, getContactByPhone } from "@/lib/store";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// GET /api/inbox/thread?conversationId=… (or ?phone=…) — one thread's messages.
// Returns 200 with conversation:null when the lead has never messaged us.
// Auth: Authorization: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const convId = url.searchParams.get("conversationId");
  const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
  if (!convId && !phone) return NextResponse.json({ error: "conversationId or phone required" }, { status: 400 });

  try {
    const conversation = convId
      ? await getConversation(convId, tenantId)
      : await getConversationByPhone(phone, tenantId);
    if (!conversation) {
      const contact = phone ? await getContactByPhone(phone, tenantId) : null;
      return NextResponse.json({ conversation: null, messages: [], contactName: contact?.name ?? "", window: "closed" });
    }
    const messages = await getConvHistory(conversation.id, 100, tenantId);
    const windowOpen = !!conversation.lastInboundAt && Date.now() - new Date(conversation.lastInboundAt).getTime() < WINDOW_MS;
    return NextResponse.json({ conversation, messages, window: windowOpen ? "open" : "closed" });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
