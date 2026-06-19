export const maxDuration = 60;
import { NextResponse } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import { getChannelByPageId, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, addOptout, isOptedOut, escalateConversation, setConversationAvatar, claimWebhookEvent, type Conversation } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { downloadRemoteMedia, transcribeAudio } from "@/lib/voice";
import { uploadAudio, uploadMedia } from "@/lib/supabase";
import { sendFbMessage, getFbProfile, sendTypingOn, type FbCreds } from "@/lib/messenger";

const OPTOUT_RE = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i;
const AI_REPLY_CAP = 6;   // safety cap before escalating a runaway thread to a human
const CLOSING_MSG = "Thanks for reaching out! 🙌 Our team will connect with you shortly.";

// GET — Meta webhook verification handshake (shared verify token, same Meta app
// as WhatsApp/Instagram).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && constEq(token ?? "", process.env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// POST — Facebook Messenger events (webhook object: "page"). Verifies
// X-Hub-Signature-256 with the app secret. entry.id is the Page id.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) {
      const channel = await getChannelByPageId(String(entry.id ?? ""));
      if (!channel || !channel.active) continue;
      for (const ev of (entry.messaging as Record<string, unknown>[]) ?? []) {
        try { await handleMessage(channel, ev); }
        catch (e) { console.error("[fb webhook] message", e); }
      }
    }
  } catch (err) {
    console.error("[fb webhook] parse error:", err);
  }
  return NextResponse.json({ received: true });
}

function credsOf(channel: Channel): FbCreds {
  return { pageId: channel.pageId ?? "", token: channel.token };
}

// Inbound message → conversation + grounded in-window AI reply.
async function handleMessage(channel: Channel, ev: Record<string, unknown>) {
  const senderId = String((ev.sender as Record<string, unknown>)?.id ?? "");
  const msg = ev.message as Record<string, unknown> | undefined;
  // A quick-reply tap carries its payload; treat its title/payload as the text.
  const quickReply = (msg?.quick_reply as Record<string, unknown> | undefined)?.payload as string | undefined;
  let text = (msg?.text as string) ?? quickReply ?? "";
  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  // Inbound media → re-host for Live Chat. Voice notes are transcribed (tenant AI)
  // so they're answered like text; images/videos are stored for display only.
  if (!text.trim() && senderId && !(msg?.is_echo as boolean)) {
    const atts = (msg?.attachments as { type?: string; payload?: { url?: string } }[]) ?? [];
    const att = atts.find(a => a.type === "audio" || a.type === "image" || a.type === "video");
    const url = att?.payload?.url;
    if (url && att) {
      const media = await downloadRemoteMedia(url);
      if (media) {
        if (att.type === "audio") {
          const t = await transcribeAudio(media, channel.tenantId);
          if (t) text = t;
          mediaUrl = await uploadAudio(media.data, media.mimeType);
        } else {
          mediaUrl = await uploadMedia(media.data, media.mimeType);
        }
        mediaType = mediaUrl ? media.mimeType : null;
      }
    }
  }
  // Ignore echoes; drop only truly empty events (no text AND no media).
  if (!senderId || (msg?.is_echo as boolean) || (!text.trim() && !mediaUrl)) return;

  // Idempotency: Meta redelivers messaging events on timeout/non-2xx. Claim the
  // message id (mid) so a redelivery can't double-fire AI replies.
  const mid = String(msg?.mid ?? "");
  if (mid && !(await claimWebhookEvent(`fb:${mid}`))) return;

  // Opt-out (STOP) honored like WhatsApp/Instagram.
  if (OPTOUT_RE.test(text)) { await addOptout(senderId, "messenger stop", channel.tenantId); return; }
  if (await isOptedOut(senderId, channel.tenantId)) return;

  let conv = await getOrCreateConversation(senderId, "", channel.id, "messenger", channel.tenantId);
  // Webhooks only carry the PSID — resolve the display name + avatar once.
  if (!conv.name || !conv.avatarUrl) {
    const prof = await getFbProfile(credsOf(channel), senderId);
    if (prof.name && !conv.name) conv = await getOrCreateConversation(senderId, prof.name, channel.id, "messenger", channel.tenantId);
    if (prof.profilePic && !conv.avatarUrl) await setConversationAvatar(conv.id, prof.profilePic).catch(() => undefined);
  }
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, source: "inbound", tenantId: channel.tenantId, mediaUrl, mediaType });
  await touchInbound(conv.id, text || (mediaType?.startsWith("video/") ? "🎥 Video" : "📷 Photo"));   // opens / refreshes the 24h window

  // A media-only message is stored + shown in Live Chat; don't run the bot on
  // empty text (an agent replies manually).
  if (!text.trim()) return;
  if (!conv.botEnabled) return;
  await aiRespond(channel, conv, text);
}

// Grounded AI responder with a per-conversation cap. After AI_REPLY_CAP replies
// (or when the model escalates) it sends a hand-off message and escalates the
// conversation to Live Chat for a human.
async function aiRespond(channel: Channel, conv: Conversation, userText: string) {
  const creds = credsOf(channel);
  const tid = channel.tenantId;
  const now = new Date().toISOString();
  const deliver = async (msg: string): Promise<boolean> => {
    const r = await sendFbMessage(creds, conv.phone, msg, { lastInboundAt: now });
    if (!r.ok) console.warn("[fb webhook] ai reply blocked:", r.blockedBy, r.error);
    return r.ok;
  };
  const closeOut = async () => { await deliver(CLOSING_MSG); await escalateConversation(conv.id); };

  if (conv.aiReplyCount >= AI_REPLY_CAP) { await closeOut(); return; }
  await sendTypingOn(creds, conv.phone);

  const history = await getConvHistory(conv.id, 20);
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body })), conv.phone, channel.agentId, tid, null, false);
  if (!r.reply || r.escalate) { await closeOut(); return; }

  if (!(await deliver(r.reply))) return;
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: r.reply, source: "bot", tenantId: tid });
  await touchOutbound(conv.id, r.reply);
}
