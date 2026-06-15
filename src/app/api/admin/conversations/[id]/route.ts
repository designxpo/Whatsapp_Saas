export const maxDuration = 30;
import { NextResponse } from "next/server";
import {
  getConversation, getConvHistory, appendConvMessage, touchOutbound,
  setConversationStatus, setBotEnabled, setConvLabels, assignConversation,
  setConversationAgent, markConversationRead, type ConvStatus,
} from "@/lib/store";
import { sendText, sendButtons } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { pushWaActivity } from "@/lib/leadsquared";
import { currentUser, currentTenantId } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — one conversation + its full message thread.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const tid = await currentTenantId();
    if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const conversation = await getConversation(id, tid);
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const messages = await getConvHistory(id, 200, tid);
    // Opening the chat marks it read (clears the "awaiting your reply" flag).
    if (conversation.needsReply) { await markConversationRead(id); conversation.needsReply = false; }
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — agent actions on a conversation.
//   { action: "reply", body, buttons? }  → manual reply; ≤3 quick-reply buttons optional
//   { action: "status", status }         → active | paused | escalated
//   { action: "bot", enabled }           → toggle the per-conversation bot
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { action?: string; body?: string; buttons?: string[]; status?: ConvStatus; enabled?: boolean; labels?: string[]; assignedTo?: string | null; agentId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conv = await getConversation(id, tid);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    if (body.action === "reply") {
      const text = (body.body ?? "").trim();
      if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
      const buttons = (body.buttons ?? []).map(b => b.trim()).filter(Boolean).slice(0, 3);
      const channel = await credsFor(conv.channelId);    // reply from the chat's own number
      const sent = buttons.length > 0
        ? await sendButtons(conv.phone, text, buttons.map((title, i) => ({ id: `btn_${i + 1}`, title })), channel)
        : await sendText(conv.phone, text, channel);
      if (sent.error) return NextResponse.json({ error: sent.error }, { status: 502 });
      const logged = buttons.length > 0 ? `${text}\n[buttons: ${buttons.join(" | ")}]` : text;
      await appendConvMessage({ conversationId: id, role: "assistant", body: logged, metaId: sent.id, source: "agent", tenantId: tid });
      await touchOutbound(id, logged);
      void pushWaActivity({ phone: conv.phone, direction: "outbound", body: logged, via: "agent" });
      logActivity(await currentUser(), "inbox.reply", `to ${conv.phone}: ${text.slice(0, 80)}`);
      return NextResponse.json({ success: true, messageId: sent.id });
    }
    if (body.action === "status" && body.status) {
      await setConversationStatus(id, body.status);
      return NextResponse.json({ success: true });
    }
    if (body.action === "bot" && typeof body.enabled === "boolean") {
      await setBotEnabled(id, body.enabled);
      return NextResponse.json({ success: true });
    }
    if (body.action === "labels" && Array.isArray(body.labels)) {
      await setConvLabels(id, body.labels);
      return NextResponse.json({ success: true });
    }
    if (body.action === "assign") {
      await assignConversation(id, body.assignedTo ?? null);
      return NextResponse.json({ success: true });
    }
    if (body.action === "agent") {
      await setConversationAgent(id, body.agentId ?? null);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
