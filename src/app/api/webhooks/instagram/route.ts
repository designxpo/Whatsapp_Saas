export const maxDuration = 180;   // inline transcription + LLM reply — match WhatsApp so a slow turn isn't killed
import { NextResponse, after } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import { getChannelByIgId, effectiveAgentId, effectiveKbTag, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, getContactByPhone, setConversationLeadPhone, landCapturedLead, addOptout, isOptedOut, incAiReplies, escalateConversation, setConversationAvatar, setConversationComment, claimWebhookEvent, type Conversation } from "@/lib/store";
import { pushIgActivity, phoneFromAttributes, extractPhone } from "@/lib/leadsquared";
import { generateReply } from "@/lib/llm";
import { isAiEnabled } from "@/lib/messaging-settings";
import { downloadRemoteMedia, transcribeAudio } from "@/lib/voice";
import { uploadAudio, uploadMedia } from "@/lib/supabase";
import { sendIgMessage, sendPrivateReply, sendIgButtons, replyToComment, within24hWindow, getIgProfile, getFollowStatus, sendTypingOn, type IgCreds, type IgButton } from "@/lib/instagram";
import { getSequenceByTrigger, enroll, matchKeywordSequence } from "@/lib/sequences";
import { handleFlowMessage } from "@/lib/flowengine";
import { matchCommentRule, claimComment, bumpRuleMatch, getCommentRule, setFollowGate, getFollowGate, clearFollowGate, type IgCommentRule } from "@/lib/igcomments";

const OPTOUT_RE = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i;
// A user replying to a follow-gate prompt to confirm they followed.
const CONFIRM_RE = /\b(follow(ed)?|done|finished|ok(ay)?|got\s?it|✅)\b/i;
// Max AI auto-replies per conversation before handing off to a human.
const AI_REPLY_CAP = 3;
const CLOSING_MSG = "Thanks for reaching out! 🙌 Our team will connect with you shortly.";

// GET — Meta webhook verification handshake (shared verify token).
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

// POST — IG messaging + comment events. Verifies X-Hub-Signature-256 with the
// app secret (same Tech Provider app as WhatsApp).
export async function POST(req: Request) {
  const raw = await req.text();
  // Instagram webhooks (Instagram-login API) are signed with the INSTAGRAM app
  // secret, which differs from the Facebook app secret. Verify against it first,
  // then fall back to META_APP_SECRET for a legacy Facebook-login setup. Without
  // this, every real IG event fails signature → 401 and never reaches the portal.
  const sig = req.headers.get("x-hub-signature-256");
  const igSecret = process.env.META_INSTAGRAM_APP_SECRET;
  if (!((igSecret && verifyMetaSignature(raw, sig, igSecret)) || verifyMetaSignature(raw, sig, process.env.META_APP_SECRET))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) {
      // entry.id is the IG professional account id → resolves the tenant's channel.
      const channel = await getChannelByIgId(String(entry.id ?? ""));
      if (!channel || !channel.active) {
        console.warn(`[ig webhook] received events for IG account ${entry.id} but no ACTIVE Instagram channel matches that account id — check the Instagram channel in the portal (and that its token hasn't expired).`);
        continue;
      }

      // Inbound DMs (Instagram messaging uses a Messenger-style `messaging` array).
      for (const ev of (entry.messaging as Record<string, unknown>[]) ?? []) {
        try {
          if (ev.postback) await handlePostback(channel, ev);
          else await handleMessage(channel, ev);
        } catch (e) { console.error("[ig webhook] message", e); }
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

// Mirror an Instagram message to the lead's LeadSquared timeline. IG users have
// no phone, so we match by a phone they've shared (saved as a contact attribute)
// first, then by @handle (needs LSQ_IG_HANDLE_FIELD). Best-effort — never blocks.
async function syncIgToLsq(conv: Conversation, body: string, direction: "inbound" | "outbound", via: "lead" | "bot" | "agent", tenantId: string) {
  try {
    const handle = conv.name && conv.name.startsWith("@") ? conv.name : null;
    const phone = conv.leadPhone || phoneFromAttributes((await getContactByPhone(conv.phone, tenantId).catch(() => null))?.attributes);
    if (!phone && !handle) return;
    await pushIgActivity({ igUserId: conv.phone, handle, phone, direction, body, via, tenantId });
  } catch { /* CRM sync must never break IG handling */ }
}

// Inbound DM → conversation + grounded in-window AI reply.
async function handleMessage(channel: Channel, ev: Record<string, unknown>) {
  const senderId = String((ev.sender as Record<string, unknown>)?.id ?? "");
  const msg = ev.message as Record<string, unknown> | undefined;
  let text = (msg?.text as string) ?? "";
  let mediaUrl: string | null = null;     // inbound media (voice/image/video), re-hosted for Live Chat
  let mediaType: string | null = null;
  // Inbound media DM → re-host so it shows in Live Chat. Voice notes are also
  // transcribed (tenant AI) so they're answered like text; images/videos are
  // stored for display only (an agent replies manually). IG delivers a short-lived
  // attachment URL, not bytes.
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

  // Idempotency: Meta redelivers IG messaging events on timeout/non-2xx.
  // Claim the message id (mid) so a redelivery can't double-fire AI replies,
  // sends or sequence enrollment.
  const mid = String(msg?.mid ?? "");
  if (mid && !(await claimWebhookEvent(`ig:${mid}`))) return;

  // Opt-out (STOP) honored like WhatsApp.
  if (OPTOUT_RE.test(text)) { await addOptout(senderId, "ig stop", channel.tenantId); return; }
  if (await isOptedOut(senderId, channel.tenantId)) return;

  let conv = await getOrCreateConversation(senderId, "", channel.id, "instagram", channel.tenantId);
  // Webhooks only carry the IGSID — resolve the @handle once (while unnamed).
  if (!conv.name || !conv.avatarUrl) {
    const prof = await getIgProfile(credsOf(channel), senderId);
    const display = prof.username ? `@${prof.username}` : prof.name;
    if (display) conv = await getOrCreateConversation(senderId, display, channel.id, "instagram", channel.tenantId);
    if (prof.profilePic && !conv.avatarUrl) await setConversationAvatar(conv.id, prof.profilePic).catch(() => undefined);
  }
  if (conv.isComment) await setConversationComment(conv.id, false);   // a real DM → move to Chats
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, source: "inbound", tenantId: channel.tenantId, channelId: channel.id, mediaUrl, mediaType });
  await touchInbound(conv.id, text || (mediaType?.startsWith("video/") ? "🎥 Video" : "📷 Photo"));   // opens / refreshes the 24-hour window
  // Capture a phone the lead shares (IG has no number of its own) so the chat can
  // be matched to a CRM lead by phone, now and on later messages.
  if (!conv.leadPhone) {
    const shared = extractPhone(text);
    if (shared) {
      await setConversationLeadPhone(conv.id, shared).catch(() => undefined);
      conv = { ...conv, leadPhone: shared };
      // New number → a Contacts row tagged instagram; a returning lead → their
      // existing contact gains the tag and this chat picks up their known name.
      await landCapturedLead(conv.phone, shared, "instagram", channel.tenantId);
    }
  }
  after(() => syncIgToLsq(conv, text, "inbound", "lead", channel.tenantId));   // mirror to LeadSquared timeline

  // Follow-gate: a waiting user's "done"/"followed" re-checks their follow.
  const gate = await getFollowGate(senderId, channel.tenantId);
  if (gate && CONFIRM_RE.test(text)) { await resolveFollowGate(channel, senderId, gate.ruleId); return; }

  // Story-reply automation: a reply to one of our stories carries reply_to.story.
  const repliedToStory = !!(msg?.reply_to as Record<string, unknown> | undefined)?.story;
  if (repliedToStory) {
    const seq = await getSequenceByTrigger("story_reply", null, channel.tenantId);
    if (seq && (!seq.triggerValue || text.toLowerCase().includes(seq.triggerValue.toLowerCase()))) {
      await enroll(seq.id, { phone: senderId, platform: "instagram", conversationId: conv.id }, channel.tenantId);
      return;
    }
  }

  // A media-only DM (image/video with no caption) is stored + shown in Live Chat
  // above; don't run the bot on empty text (an agent replies manually).
  if (!text.trim()) return;
  if (!conv.botEnabled) return;

  // Chatbot flows (platform='instagram') run first; AI is the fallback.
  const flowHandled = await handleFlowMessage(conv.id, senderId, text, { channel }).catch(() => false);
  if (flowHandled) return;

  // Keyword-triggered sequence opts the sender into a timed drip; suppress AI.
  const kwSeq = await matchKeywordSequence("instagram", text, channel.tenantId).catch(() => null);
  if (kwSeq) { await enroll(kwSeq.id, { phone: senderId, platform: "instagram", conversationId: conv.id }, channel.tenantId); return; }

  await aiRespond(channel, conv, text);
}

// Shared AI responder with a per-conversation cap. Generates a grounded reply;
// after AI_REPLY_CAP replies (or when the model escalates) it sends a hand-off
// message and escalates the conversation to the portal (Live Chat, needs human).
// `commentId` set → first contact is the one-time private reply + a public reply.
async function aiRespond(channel: Channel, conv: Conversation, userText: string, commentId?: string) {
  // Tenant-wide AI switch (Settings → AI auto-replies) — a human turned the AI off.
  if (!(await isAiEnabled(channel.tenantId))) return;
  const creds = credsOf(channel);
  const tid = channel.tenantId;
  const now = new Date().toISOString();
  // Comment-triggered AI replies PUBLICLY under the comment (never a DM).
  // DM-triggered AI replies in the DM. (Rule-based comment-to-DM is separate and
  // intentionally DMs — handled in handleComment.)
  const deliver = async (msg: string): Promise<boolean> => {
    if (commentId) return (await replyToComment(creds, commentId, msg)).ok;
    const r = await sendIgMessage(creds, conv.phone, msg, { lastInboundAt: now });
    if (!r.ok) console.warn("[ig webhook] ai reply blocked:", r.blockedBy, r.error);
    return r.ok;
  };
  const closeOut = async () => { await deliver(CLOSING_MSG); await escalateConversation(conv.id); };

  // The cap applies to comment-triggered AI only; direct DMs are uncapped.
  if (commentId && conv.aiReplyCount >= AI_REPLY_CAP) { await closeOut(); return; }

  // DM replies: show a "typing…" indicator while the model composes (comment
  // replies post publicly, so no DM typing there).
  if (!commentId) await sendTypingOn(creds, conv.phone);

  const history = await getConvHistory(conv.id, 20);
  // On DMs where we still have no phone for this IG lead, let the AI ask for it once.
  const askPhone = !commentId && !conv.leadPhone;
  // Conversation pin / flow-stamped KB tag → this IG account's persona +
  // allocated KB → tenant-global (used to hardcode a null KB scope).
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body.replace(/^\[comment\] /, ""), mediaUrl: h.mediaUrl, mediaType: h.mediaType })), conv.phone, effectiveAgentId(conv, channel), tid, effectiveKbTag(conv, channel), askPhone);
  if (!r.reply || r.escalate) { await closeOut(); return; }

  if (!(await deliver(r.reply))) return;
  const replyBody = r.reply;
  // Tag comment replies so Live Chat shows them as comment replies, not DMs.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: commentId ? `[comment] ${replyBody}` : replyBody, source: "bot", tenantId: tid, channelId: channel.id });
  await touchOutbound(conv.id, replyBody);   // AI handled it → clear "awaiting your reply"
  if (!commentId) after(() => syncIgToLsq(conv, replyBody, "outbound", "bot", tid));   // DM AI replies → LeadSquared
  if (commentId) await incAiReplies(conv.id, conv.aiReplyCount);
}

// Comment → ManyChat-style automation. Matches the comment against this tenant's
// rules (account + per-post + keyword), then sends ONE private DM (the comment
// is the opt-in; Meta allows a single private reply per comment), optionally
// behind a follow gate, with a link button + optional public reply.
async function handleComment(channel: Channel, value: Record<string, unknown>) {
  const commentId = String(value.id ?? "");
  const text = String(value.text ?? "");
  const from = (value.from as Record<string, unknown>) ?? {};
  const fromId = String(from.id ?? "");
  // Comment webhooks carry the commenter's @username — use it directly so the
  // inbox shows the handle, not the raw IGSID (the Profile API can't resolve a
  // commenter who never opened a DM).
  const fromUsername = String(from.username ?? "");
  const mediaId = String((value.media as Record<string, unknown>)?.id ?? "") || null;
  if (!commentId || !text) return;
  if (fromId && channel.igUserId && fromId === channel.igUserId) return;   // never reply to ourselves

  const tid = channel.tenantId;
  const rule = await matchCommentRule(text, mediaId, tid, channel.id);

  // No fixed rule matched → let the AI answer the comment contextually (public
  // reply + DM), capped + escalating to a human after AI_REPLY_CAP replies.
  if (!rule) {
    if (!(await claimComment(commentId, null, tid))) return;
    // Prefer the @username carried in the comment payload; fall back to the
    // Profile API (works only if they've also DMed) for name + avatar.
    const handle = fromUsername ? `@${fromUsername}` : "";
    let conv = await getOrCreateConversation(fromId, handle, channel.id, "instagram", tid);
    if (!conv.name || !conv.avatarUrl) {
      const prof = await getIgProfile(credsOf(channel), fromId);
      const display = handle || (prof.username ? `@${prof.username}` : prof.name);
      if (display && display !== conv.name) conv = await getOrCreateConversation(fromId, display, channel.id, "instagram", tid);
      if (prof.profilePic && !conv.avatarUrl) await setConversationAvatar(conv.id, prof.profilePic).catch(() => undefined);
    }
    // This thread came from a COMMENT → keep it in the Comments section.
    await setConversationComment(conv.id, true);
    if (!conv.botEnabled) return;   // a human is handling this thread
    // Marker so Live Chat shows this came from a COMMENT, not a DM.
    await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${text}`, source: "inbound", tenantId: tid, channelId: channel.id });
    await aiRespond(channel, conv, text, commentId);
    return;
  }

  // Idempotency: claim the comment so a webhook redelivery can't double-DM.
  if (!(await claimComment(commentId, rule.id, tid))) return;

  const creds = credsOf(channel);
  let sent;
  if (rule.requireFollow && (await getFollowStatus(creds, fromId)) !== true) {
    sent = await sendPrivateReply(creds, commentId, followPromptText(rule), await followButtons(channel, rule));
    if (sent.ok) await setFollowGate(fromId, rule.id, channel.id, tid);
  } else {
    sent = await sendPrivateReply(creds, commentId, rule.dmMessage, rewardButtons(rule));
  }
  if (!sent.ok) { console.warn("[ig webhook] comment DM blocked:", sent.blockedBy, sent.error); return; }

  await bumpRuleMatch(rule.id, rule.matchCount, tid);
  if (rule.publicReply) {
    await replyToComment(creds, commentId, rule.publicReply).catch(e => console.error("[ig webhook] public reply", e));
  }
}

// Postback button taps (e.g. "I've followed ✅") arrive as messaging events.
async function handlePostback(channel: Channel, ev: Record<string, unknown>) {
  const senderId = String((ev.sender as Record<string, unknown>)?.id ?? "");
  const payload = String((ev.postback as Record<string, unknown>)?.payload ?? "");
  if (!senderId) return;
  if (payload.startsWith("FOLLOWCHK:")) await resolveFollowGate(channel, senderId, payload.slice("FOLLOWCHK:".length));
}

// Re-check follow and deliver the held reward or re-prompt. When Meta can't
// verify (null, pre-App-Review) we trust the tap so real followers aren't blocked.
async function resolveFollowGate(channel: Channel, igsid: string, ruleId: string) {
  const tid = channel.tenantId;
  const rule = await getCommentRule(ruleId, tid);
  if (!rule) { await clearFollowGate(igsid, tid); return; }
  const creds = credsOf(channel);
  const follows = await getFollowStatus(creds, igsid);
  const now = new Date().toISOString();
  if (follows === false) {
    await sendIgButtons(creds, igsid, "I don't see a follow yet 👀 — tap Visit profile, hit Follow, then tap “I've followed”.", await followButtons(channel, rule), { lastInboundAt: now });
    return;
  }
  const buttons = rewardButtons(rule);
  const sent = buttons.length
    ? await sendIgButtons(creds, igsid, rule.dmMessage, buttons, { lastInboundAt: now })
    : await sendIgMessage(creds, igsid, rule.dmMessage, { lastInboundAt: now });
  if (sent.ok) { await clearFollowGate(igsid, tid); await bumpRuleMatch(rule.id, rule.matchCount, tid); }
  else console.warn("[ig webhook] reward blocked:", sent.blockedBy, sent.error);
}

function rewardButtons(rule: IgCommentRule): IgButton[] {
  return rule.buttonUrl ? [{ type: "web_url", url: rule.buttonUrl, title: (rule.buttonLabel || "Open link").slice(0, 20) }] : [];
}
function followPromptText(rule: IgCommentRule): string {
  return rule.followPrompt?.trim() || "Almost there! Follow us first, then tap “I've followed” to get your link 🎁";
}
async function followButtons(channel: Channel, rule: IgCommentRule): Promise<IgButton[]> {
  const buttons: IgButton[] = [];
  const me = await getIgProfile(credsOf(channel), channel.igUserId ?? "");
  if (me.username) buttons.push({ type: "web_url", url: `https://instagram.com/${me.username}`, title: "Visit profile" });
  buttons.push({ type: "postback", title: "I've followed ✅", payload: `FOLLOWCHK:${rule.id}` });
  return buttons;
}
