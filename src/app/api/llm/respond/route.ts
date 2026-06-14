export const maxDuration = 60;
import { NextResponse } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { respondToConversation } from "@/lib/assistant";

// POST /api/llm/respond — generate + send an AI reply for one conversation.
// Auth: Bearer CRON_SECRET. Called fire-and-forget by the webhook and by cron.
// Body: { conversationId: string }
export async function POST(req: Request) {
  if (!cronOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { conversationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  try {
    const result = await respondToConversation(body.conversationId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
