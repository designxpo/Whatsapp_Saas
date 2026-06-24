export const maxDuration = 180;   // inline transcription + LLM reply — match WhatsApp so a slow turn isn't killed
import { NextResponse } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import { getChannelByPageId, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, addOptout, isOptedOut, escalateConversation, setConversationAvatar, setConversationComment, incAiReplies, claimWebhookEvent, type Conversation } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { downloadRemoteMedia, transcribeAudio } from "@/lib/voice";
import { uploadAudio, uploadMedia } from "@/lib/supabase";
import { sendFbMessage, getFbProfile, sendTypingOn, sendFbPrivateReply, replyToFbComment, type FbCreds, type FbButton } from "@/lib/messenger";
import { matchCommentRule, claimComment, bumpRuleMatch } from "@/lib/fbcomments";
import { handleFlowMessage } from "@/lib/flowengine";

const OPTOUT_RE = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i;
const AI_REPLY_CAP = 6;   // safety cap before escalating a runaway thread to a human
const CLOSING_MSG = "Thanks for reaching out! 🙌 Our team will connect with you shortly.";

// GET — Meta webhook verification handshake (same Meta app as WhatsApp/Instagram).
// Accepts the shared verify token, or falls back to the WhatsApp one
// (META_WA_WEBHOOK_VERIFY_TOKEN) so a separate token never has to be configured.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const ok = constEq(token ?? "", process.env.META_WEBHOOK_VERIFY_TOKEN)
          || constEq(token ?? "", process.env.META_WA_WEBHOOK_VERIFY_TOKEN);
  if (mode === "subscribe" && ok) {
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
      if (!channel || !channel.active) {
        // Events ARE arriving but nothing stores them — almost always the cause of
        // "Facebook 0" in Live Chat: no active Messenger channel matches this Page.
        console.warn(`[fb webhook] received events for Page ${entry.id} but no ACTIVE Messenger channel matches that Page ID — add/activate a Facebook channel with this exact Page ID in the portal.`);
        continue;
      }
      for (const ev of (entry.messaging as Record<string, unknown>[]) ?? []) {
        try { await handleMessage(channel, ev); }
        catch (e) { console.error("[fb webhook] message", e); }
      }
      // Page feed changes carry post comments (item:"comment") → comment-to-DM.
      for (const change of (entry.changes as Record<string, unknown>[]) ?? []) {
        if (change.field !== "feed") continue;
        try { await handleComment(channel, change.value as Record<string, unknown>); }
        catch (e) { console.error("[fb webhook] comment", e); }
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
  // Chatbot flows run BEFORE the AI (mirrors WhatsApp/Instagram): a keyword/menu
  // flow scoped to this Page handles the message; otherwise fall through to the AI.
  const flowHandled = await handleFlowMessage(conv.id, senderId, text, { channel }).catch(() => false);
  if (flowHandled) return;
  await aiRespond(channel, conv, text);
}

// Grounded AI responder. A direct DM (no commentId) replies in the DM and is
// uncapped. A comment-triggered reply (commentId set) posts PUBLICLY under the
// comment and is capped — after AI_REPLY_CAP replies (or when the model
// escalates) it sends a hand-off message and escalates to Live Chat for a human.
async function aiRespond(channel: Channel, conv: Conversation, userText: string, commentId?: string) {
  const creds = credsOf(channel);
  const tid = channel.tenantId;
  const now = new Date().toISOString();
  const deliver = async (msg: string): Promise<boolean> => {
    if (commentId) return (await replyToFbComment(creds, commentId, msg)).ok;
    const r = await sendFbMessage(creds, conv.phone, msg, { lastInboundAt: now });
    if (!r.ok) console.warn("[fb webhook] ai reply blocked:", r.blockedBy, r.error);
    return r.ok;
  };
  const closeOut = async () => { await deliver(CLOSING_MSG); await escalateConversation(conv.id); };

  // The cap applies to comment-triggered AI only; direct DMs stay uncapped.
  if (commentId && conv.aiReplyCount >= AI_REPLY_CAP) { await closeOut(); return; }
  if (!commentId) await sendTypingOn(creds, conv.phone);

  const history = await getConvHistory(conv.id, 20);
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body.replace(/^\[comment\] /, ""), mediaUrl: h.mediaUrl, mediaType: h.mediaType })), conv.phone, channel.agentId, tid, null, false);
  if (!r.reply || r.escalate) { await closeOut(); return; }

  if (!(await deliver(r.reply))) return;
  // Tag comment replies so Live Chat shows them as comment replies, not DMs.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: commentId ? `[comment] ${r.reply}` : r.reply, source: "bot", tenantId: tid });
  await touchOutbound(conv.id, r.reply);
  if (commentId) await incAiReplies(conv.id, conv.aiReplyCount);
}

// Comment → ManyChat-style automation. Matches the comment against this tenant's
// saved rules (per-post + keyword), then sends ONE private reply / DM (the
// comment is the opt-in; Meta allows a single private reply per comment) with an
// optional link button, plus an optional public reply. When no rule matches, the
// AI answers the comment publicly (capped). Most comments match nothing → no DM.
async function handleComment(channel: Channel, value: Record<string, unknown>) {
  // Page feed events also cover posts, reactions and shares — only NEW comments.
  if (String(value.item ?? "") !== "comment" || String(value.verb ?? "") !== "add") return;
  const tid = channel.tenantId;
  const commentId = String(value.comment_id ?? "");
  const text = String(value.message ?? "");
  const from = (value.from as Record<string, unknown>) ?? {};
  const fromId = String(from.id ?? "");
  const fromName = String(from.name ?? "");
  // Webhook post_id is the {pageId}_{postId} form — matches fetchFbPosts ids.
  const postId = String(value.post_id ?? "") || null;
  if (!commentId || !text) return;
  if (fromId && channel.pageId && fromId === channel.pageId) return;   // never reply to ourselves

  const rule = await matchCommentRule(text, postId, tid, channel.id);

  // No fixed rule matched → let the AI answer the comment publicly, capped and
  // escalating to a human after AI_REPLY_CAP replies.
  if (!rule) {
    if (!(await claimComment(commentId, null, tid))) return;
    const conv = await getOrCreateConversation(fromId, fromName, channel.id, "messenger", tid);
    // This thread came from a COMMENT → keep it in the Comments section.
    await setConversationComment(conv.id, true);
    if (!conv.botEnabled) return;   // a human is handling this thread
    // Marker so Live Chat shows this came from a COMMENT, not a DM.
    await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${text}`, source: "inbound", tenantId: tid });
    await aiRespond(channel, conv, text, commentId);
    return;
  }

  // Idempotency: claim the comment so a webhook redelivery can't double-DM.
  if (!(await claimComment(commentId, rule.id, tid))) return;

  const creds = credsOf(channel);
  const buttons: FbButton[] = rule.buttonUrl
    ? [{ type: "web_url", url: rule.buttonUrl, title: (rule.buttonLabel || "Open link").slice(0, 20) }]
    : [];
  const sent = await sendFbPrivateReply(creds, commentId, rule.dmMessage, buttons);
  if (!sent.ok) { console.warn("[fb webhook] comment DM blocked:", sent.blockedBy, sent.error); return; }

  await bumpRuleMatch(rule.id, rule.matchCount, tid);
  if (rule.publicReply) {
    await replyToFbComment(creds, commentId, rule.publicReply).catch(e => console.error("[fb webhook] public reply", e));
  }
}
