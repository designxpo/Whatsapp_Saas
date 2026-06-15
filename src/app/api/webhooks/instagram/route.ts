export const maxDuration = 60;
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getChannelByIgId, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, getConvHistory, addOptout, optoutSet } from "@/lib/store";
import { getTenantSetting } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { sendIgMessage, sendPrivateReply, within24hWindow, type IgCreds } from "@/lib/instagram";
import { getSequenceByTrigger, enroll } from "@/lib/sequences";
import { handleFlowMessage } from "@/lib/flowengine";

const OPTOUT_RE = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i;

// GET — Meta webhook verification handshake (shared verify token).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// POST — IG messaging + comment events. Verifies X-Hub-Signature-256 with the
// app secret (same Tech Provider app as WhatsApp).
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const secret = process.env.META_APP_SECRET;
  if (secret) {
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
  }

  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) {
      // entry.id is the IG professional account id → resolves the tenant's channel.
      const channel = await getChannelByIgId(String(entry.id ?? ""));
      if (!channel || !channel.active) continue;

      // Inbound DMs (Instagram messaging uses a Messenger-style `messaging` array).
      for (const ev of (entry.messaging as Record<string, unknown>[]) ?? []) {
        try { await handleMessage(channel, ev); } catch (e) { console.error("[ig webhook] message", e); }
      }
      // Comment events (field: 'comments').
      for (const change of (entry.changes as Record<string, unknown>[]) ?? []) {
        if (change.field !== "comments") continue;
        try { await handleComment(channel, change.value as Record<string, unknown>); }
        catch (e) { console.error("[ig webhook] comment", e); }
      }
    }
  } catch (err) {
    console.error("[ig webhook] parse error:", err);
  }
  return NextResponse.json({ received: true });
}

function credsOf(channel: Channel): IgCreds {
  return { igUserId: channel.igUserId ?? "", token: channel.token };
}

// Inbound DM → conversation + grounded in-window AI reply.
async function handleMessage(channel: Channel, ev: Record<string, unknown>) {
  const senderId = String((ev.sender as Record<string, unknown>)?.id ?? "");
  const msg = ev.message as Record<string, unknown> | undefined;
  const text = (msg?.text as string) ?? "";
  // Ignore echoes (our own outbound) and non-text events.
  if (!senderId || !text.trim() || (msg?.is_echo as boolean)) return;

  // Opt-out (STOP) honored like WhatsApp.
  if (OPTOUT_RE.test(text)) { await addOptout(senderId, "ig stop", channel.tenantId); return; }
  if ((await optoutSet()).has(senderId.slice(-10))) return;

  const conv = await getOrCreateConversation(senderId, "", channel.id, "instagram", channel.tenantId);
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, source: "inbound", tenantId: channel.tenantId });
  await touchInbound(conv.id, text);   // opens / refreshes the 24-hour window

  // Story-reply automation: a reply to one of our stories carries reply_to.story.
  const repliedToStory = !!(msg?.reply_to as Record<string, unknown> | undefined)?.story;
  if (repliedToStory) {
    const seq = await getSequenceByTrigger("story_reply");
    if (seq && (!seq.triggerValue || text.toLowerCase().includes(seq.triggerValue.toLowerCase()))) {
      await enroll(seq.id, { phone: senderId, platform: "instagram", conversationId: conv.id });
      return;
    }
  }

  if (!conv.botEnabled) return;

  // Chatbot flows (platform='instagram') run first; AI is the fallback.
  const flowHandled = await handleFlowMessage(conv.id, senderId, text, { channel }).catch(() => false);
  if (flowHandled) return;

  // Reply only inside the window (touchInbound just set it, so this holds now).
  if (!within24hWindow(new Date().toISOString())) return;

  const history = await getConvHistory(conv.id, 20);
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body })), senderId, channel.agentId);
  if (r.reply && !r.escalate) {
    const sent = await sendIgMessage(credsOf(channel), senderId, r.reply, { lastInboundAt: new Date().toISOString() });
    if (sent.ok) await appendConvMessage({ conversationId: conv.id, role: "assistant", body: r.reply, source: "bot", tenantId: channel.tenantId });
    else console.warn("[ig webhook] reply blocked:", sent.blockedBy, sent.error);
  }
}

// Comment → optional ONE-TIME private reply, only when a keyword rule is enabled.
// Never auto-replies to every comment (that risks spam flags). The comment is
// the user's opt-in; the private reply is a single block (Meta rule).
async function handleComment(channel: Channel, value: Record<string, unknown>) {
  const commentId = String(value.id ?? "");
  const text = String(value.text ?? "");
  const fromId = String((value.from as Record<string, unknown>)?.id ?? "");
  if (!commentId || !text) return;
  // Don't reply to our own comments.
  if (fromId && channel.igUserId && fromId === channel.igUserId) return;

  const rule = await getTenantSetting<{ enabled?: boolean; keyword?: string; message?: string }>(
    channel.tenantId, "ig_comment_dm", {},
  );
  if (!rule?.enabled || !rule.message) return;
  // If a keyword is configured, require it (case-insensitive substring).
  if (rule.keyword && !text.toLowerCase().includes(rule.keyword.toLowerCase())) return;

  await sendPrivateReply(credsOf(channel), commentId, rule.message);
}
