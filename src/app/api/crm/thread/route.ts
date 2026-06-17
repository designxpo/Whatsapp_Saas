import { NextResponse } from "next/server";
import { getConversationByPhone, getConvHistory, getContactByPhone, listQuickReplies, getIgConversationByLeadPhone } from "@/lib/store";
import { crmAuthorized } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// GET ?phone= — the lead's conversation thread, for the CRM chat panel.
// Returns 200 with conversation:null when the lead has never messaged us.
export async function GET(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phone = (new URL(req.url).searchParams.get("phone") ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  try {
    const quickReplies = await listQuickReplies().catch(() => []);
    // An Instagram thread linked to this phone (the lead shared it in chat) —
    // shown read-only beside WhatsApp so the CRM sees the full picture.
    const igConv = await getIgConversationByLeadPhone(phone).catch(() => null);
    const ig = igConv
      ? { conversation: igConv, messages: await getConvHistory(igConv.id, 200).catch(() => []) }
      : null;

    const conversation = await getConversationByPhone(phone);
    if (!conversation) {
      const contact = await getContactByPhone(phone);
      return NextResponse.json({ conversation: null, messages: [], contactName: contact?.name ?? "", window: "closed", quickReplies, ig });
    }
    const messages = await getConvHistory(conversation.id, 200);
    const windowOpen = !!conversation.lastInboundAt && Date.now() - new Date(conversation.lastInboundAt).getTime() < WINDOW_MS;
    return NextResponse.json({ conversation, messages, window: windowOpen ? "open" : "closed", quickReplies, ig });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
