export const maxDuration = 180;   // inline transcription + LLM reply — match WhatsApp so a slow turn isn't killed
import { NextResponse, after } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import { getChannelByIgId, getChannelById, effectiveAgentId, effectiveKbTag, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, getContactByPhone, setConversationLeadPhone, landCapturedLead, addOptout, isOptedOut, incAiReplies, escalateConversation, setConversationAvatar, setConversationComment, claimWebhookEvent, logSendFailure, type Conversation } from "@/lib/store";
import { pushIgActivity, phoneFromAttributes, extractPhone } from "@/lib/leadsquared";
import { generateReply } from "@/lib/llm";
import { isAiEnabled } from "@/lib/messaging-settings";
import { downloadRemoteMedia, transcribeAudio } from "@/lib/voice";
import { uploadAudio, uploadMedia } from "@/lib/supabase";
import { sendIgMessage, sendPrivateReply, sendIgButtons, replyToComment, within24hWindow, getIgProfile, getFollowStatus, sendTypingOn, type IgCreds, type IgButton } from "@/lib/instagram";
import { getSequenceByTrigger, enroll, matchKeywordSequence } from "@/lib/sequences";
import { handleFlowMessage } from "@/lib/flowengine";
import { matchCommentRule, claimComment, bumpRuleMatch, getCommentRule, setFollowGate, getFollowGate, clearFollowGate, pickPublicReply, type IgCommentRule } from "@/lib/igcomments";
import { getCommentWatch, trackCommentWatch, MAX_AI_THREAD_DEPTH, type CommentWatch } from "@/lib/commentthreads";

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
    // This 401 used to be silent, which is the worst possible place for silence:
    // Meta keeps delivering, we keep rejecting, and in the portal it looks like
    // the account simply never receives a message. The usual cause is
    // META_INSTAGRAM_APP_SECRET missing in the deployment — the Instagram-login
    // app is a SEPARATE Meta app from the Facebook one and signs with its own
    // secret, so the fallback cannot match.
    console.error("[ig webhook] SIGNATURE REJECTED — event dropped", {
      hasSignatureHeader: !!sig,
      igSecretConfigured: !!igSecret,
      fbSecretConfigured: !!process.env.META_APP_SECRET,
      hint: !igSecret ? "META_INSTAGRAM_APP_SECRET is not set in this deployment" : "signature matched neither secret — check it is the Instagram app secret",
    });
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(raw);
    console.log("[ig webhook] received", {
      entries: (body.entry ?? []).map((e: Record<string, unknown>) => ({
        igAccountId: String(e.id ?? ""),
        messaging: Array.isArray(e.messaging) ? e.messaging.length : 0,
        changes: Array.isArray(e.changes) ? e.changes.length : 0,
      })),
    });
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
async function syncIgToLsq(channel: Channel, conv: Conversation, body: string, direction: "inbound" | "outbound", via: "lead" | "bot" | "agent") {
  try {
    const handle = conv.name && conv.name.startsWith("@") ? conv.name : null;
    const phone = conv.leadPhone || phoneFromAttributes((await getContactByPhone(conv.phone, channel.tenantId).catch(() => null))?.attributes);
    if (!phone && !handle) return;
    await pushIgActivity({ igUserId: conv.phone, handle, phone, direction, body, via, tenantId: channel.tenantId, source: channel.crmSource || undefined });
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
  // Anchor to the conversation's OWN account. `channel` came from the webhook's
  // account id, but if this thread already belongs to a different IG channel
  // (e.g. the same user first engaged another of the tenant's accounts), persona,
  // KB and send creds must follow the account the conversation is on — not bleed
  // in the wrong (or global-default) persona/KB. New threads: ids match, no-op.
  if (conv.channelId && conv.channelId !== channel.id) {
    const owner = await getChannelById(conv.channelId);
    if (owner) channel = owner;
  }
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
  after(() => syncIgToLsq(channel, conv, text, "inbound", "lead"));   // mirror to LeadSquared timeline

  // Follow-gate: a waiting user's "done"/"followed" re-checks their follow.
  const gate = await getFollowGate(senderId, channel.tenantId);
  if (gate && CONFIRM_RE.test(text)) { await resolveFollowGate(channel, senderId, gate.ruleId); return; }

  // Story-reply automation: a reply to one of our stories carries reply_to.story.
  const repliedToStory = !!(msg?.reply_to as Record<string, unknown> | undefined)?.story;
  if (repliedToStory) {
    const seq = await getSequenceByTrigger("story_reply", null, channel.tenantId);
    const gated = !!seq && (!seq.triggerValue || text.toLowerCase().includes(seq.triggerValue.toLowerCase()));
    // Diagnostic: shows in Vercel logs exactly why a story reply did/didn't enrol.
    console.log(JSON.stringify({ tag: "ig_story_reply", tenant: channel.tenantId, hasSeq: !!seq, seqId: seq?.id ?? null, active: seq?.active ?? null, triggerValue: seq?.triggerValue ?? null, gated, textSample: text.slice(0, 40) }));
    if (seq && gated) {
      await enroll(seq.id, { phone: senderId, platform: "instagram", conversationId: conv.id }, channel.tenantId);
      return;
    }
  } else if (msg?.reply_to) {
    // A reply that ISN'T to a story — log its shape so we can see what Meta sent.
    console.log(JSON.stringify({ tag: "ig_reply_to_shape", keys: Object.keys(msg.reply_to as object) }));
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
    const r = commentId ? await replyToComment(creds, commentId, msg) : await sendIgMessage(creds, conv.phone, msg, { lastInboundAt: now });
    if (!r.ok) {
      console.warn("[ig webhook] ai reply blocked:", "blockedBy" in r ? r.blockedBy : undefined, r.error);
      await logSendFailure(conv.id, channel.id, r.error || "unknown error", tid);
    }
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
  // Direct DMs get the cross-channel cart (list/add/checkout) via the AI's
  // built-in commerce tools; public comment replies never sell.
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body.replace(/^\[comment\] /, ""), mediaUrl: h.mediaUrl, mediaType: h.mediaType })), conv.phone, effectiveAgentId(conv, channel), tid, effectiveKbTag(conv, channel), askPhone, commentId ? undefined : { platform: "instagram", conversationId: conv.id });
  if (!r.reply || r.escalate) { await closeOut(); return; }

  if (!(await deliver(r.reply))) return;
  const replyBody = r.reply;
  // Tag comment replies so Live Chat shows them as comment replies, not DMs.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: commentId ? `[comment] ${replyBody}` : replyBody, source: "bot", tenantId: tid, channelId: channel.id });
  await touchOutbound(conv.id, replyBody);   // AI handled it → clear "awaiting your reply"
  if (!commentId) after(() => syncIgToLsq(channel, conv, replyBody, "outbound", "bot"));   // DM AI replies → LeadSquared
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

  // AI takeover: a reply inside a thread a rule already answered → the AI responds
  // in context (original comment + our reply + this follow-up), instead of the
  // canned rule firing again. Gated by the per-account "AI answers comments" switch.
  const parentId = String(value.parent_id ?? "") || null;
  if (parentId && channel.commentAi) {
    const watch = await getCommentWatch(parentId, tid);
    if (watch) {
      if (!(await claimComment(commentId, null, tid))) return;
      await aiThreadReply(channel, watch, { commentId, text, fromId, fromUsername });
      return;
    }
  }

  const rule = await matchCommentRule(text, mediaId, tid, channel.id);

  // No fixed rule matched → let the AI answer the comment contextually (public
  // reply + DM), capped + escalating to a human after AI_REPLY_CAP replies.
  if (!rule) {
    // Per-account switch: if AI comment replies are off, leave un-ruled comments
    // untouched (fixed rules still fire; DMs are unaffected).
    if (!channel.commentAi) return;
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

  // Record the comment in the portal's Comments tab. Previously a rule-matched
  // comment sent its DM silently and never appeared in the portal (only the
  // no-rule/AI path above stored comments) — mirror that storage here so the
  // team sees which comments fired a rule.
  const handle = fromUsername ? `@${fromUsername}` : "";
  let conv = await getOrCreateConversation(fromId, handle, channel.id, "instagram", tid);
  if (!conv.name || !conv.avatarUrl) {
    const prof = await getIgProfile(creds, fromId);
    const display = handle || (prof.username ? `@${prof.username}` : prof.name);
    if (display && display !== conv.name) conv = await getOrCreateConversation(fromId, display, channel.id, "instagram", tid);
    if (prof.profilePic && !conv.avatarUrl) await setConversationAvatar(conv.id, prof.profilePic).catch(() => undefined);
  }
  await setConversationComment(conv.id, true);
  await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${text}`, source: "inbound", tenantId: tid, channelId: channel.id });

  // Reply-only rule: post a public reply (rotated) and send NO DM at all.
  if (rule.replyOnly) {
    const publicReply = pickPublicReply(rule);
    if (publicReply) {
      // replyToComment RETURNS { ok:false } on a rate cap / moderation block /
      // Graph error instead of throwing, so carry a reason on the thrown path too
      // and both failure shapes can be reported the same way.
      const res = await replyToComment(creds, commentId, publicReply).catch(e => { console.error("[ig webhook] reply-only public reply", e); return { ok: false as const, error: e instanceof Error ? e.message : "Comment reply error" }; });
      if (res.ok) {
        await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${publicReply}`, source: "bot", tenantId: tid, channelId: channel.id });
        await bumpRuleMatch(rule.id, rule.matchCount, tid);
        // Watch this thread so a follow-up reply escalates to the AI.
        await trackCommentWatch([commentId, res.id], { tenantId: tid, channelId: channel.id, platform: "instagram", rootCommentId: commentId, originalText: text, replyText: publicReply, depth: 0 });
      } else {
        // A reply-only rule sends no DM, so a failed public reply means the
        // commenter got NOTHING — surface it in the thread, not just the logs.
        console.warn("[ig webhook] reply-only public reply blocked:", res.error);
        await logSendFailure(conv.id, channel.id, res.error || "unknown error", tid);
      }
    }
    return;
  }

  const followGate = rule.requireFollow && (await getFollowStatus(creds, fromId)) !== true;
  const dmBody = followGate ? followPromptText(rule) : rule.dmMessage;
  let sent;
  if (followGate) {
    sent = await sendPrivateReply(creds, commentId, followPromptText(rule), await followButtons(channel, rule));
    if (sent.ok) await setFollowGate(fromId, rule.id, channel.id, tid);
  } else {
    sent = await sendPrivateReply(creds, commentId, rule.dmMessage, rewardButtons(rule));
  }
  if (!sent.ok) {
    // The commenter gets nothing — record it in the thread like the AI path does,
    // so the portal shows WHY instead of the DM vanishing into the logs.
    console.warn("[ig webhook] comment DM blocked:", sent.blockedBy, sent.error);
    await logSendFailure(conv.id, channel.id, sent.error || "unknown error", tid);
    return;
  }

  // Mirror the automated DM into the portal thread so the team sees what was sent.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${dmBody}`, source: "bot", tenantId: tid, channelId: channel.id });
  await touchOutbound(conv.id, dmBody);

  await bumpRuleMatch(rule.id, rule.matchCount, tid);
  // Public reply: pick ONE variant at random so repeated comments never get an
  // identical reply (identical automated replies are an IG spam/ban signal).
  const publicReply = pickPublicReply(rule);
  if (publicReply) {
    const pr = await replyToComment(creds, commentId, publicReply).catch(e => { console.error("[ig webhook] public reply", e); return { ok: false as const, error: e instanceof Error ? e.message : "Comment reply error" }; });
    // Watch this thread so a follow-up reply escalates to the AI. The DM already
    // landed (mirrored above), so no "not delivered" note here — only the public
    // reply is missing, and with it this thread's AI-takeover watch.
    if (pr.ok) await trackCommentWatch([commentId, pr.id], { tenantId: tid, channelId: channel.id, platform: "instagram", rootCommentId: commentId, originalText: text, replyText: publicReply, depth: 0 });
    else console.warn("[ig webhook] public reply blocked:", pr.error);
  }
}

// A follow-up landed in a thread a rule opened → the AI answers it in context
// (original comment + our reply + this follow-up), grounded in the channel's
// persona + KB. Capped by depth + the 60/hr reply limiter; never fires on our
// own comments (guarded in handleComment).
async function aiThreadReply(channel: Channel, watch: CommentWatch, fu: { commentId: string; text: string; fromId: string; fromUsername: string }) {
  const tid = channel.tenantId;
  if (!(await isAiEnabled(tid))) return;
  if (watch.depth >= MAX_AI_THREAD_DEPTH) return;   // anti-runaway cap
  const creds = credsOf(channel);
  const handle = fu.fromUsername ? `@${fu.fromUsername}` : "";
  let conv = await getOrCreateConversation(fu.fromId, handle, channel.id, "instagram", tid);
  if (!conv.name) {
    const prof = await getIgProfile(creds, fu.fromId);
    const display = handle || (prof.username ? `@${prof.username}` : prof.name);
    if (display && display !== conv.name) conv = await getOrCreateConversation(fu.fromId, display, channel.id, "instagram", tid);
  }
  await setConversationComment(conv.id, true);
  if (!conv.botEnabled) return;   // a human is handling this thread
  await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${fu.text}`, source: "inbound", tenantId: tid, channelId: channel.id });
  const history = [
    { role: "user" as const, body: watch.originalText, mediaUrl: null, mediaType: null },
    { role: "assistant" as const, body: watch.replyText, mediaUrl: null, mediaType: null },
    { role: "user" as const, body: fu.text, mediaUrl: null, mediaType: null },
  ].filter(h => h.body);
  const r = await generateReply(history, conv.phone, effectiveAgentId(conv, channel), tid, effectiveKbTag(conv, channel), false, undefined);
  if (!r.reply || r.escalate) return;
  const sent = await replyToComment(creds, watch.rootCommentId, r.reply);
  if (!sent.ok) {
    // The follow-up got no answer — say why in the thread, like the AI DM path does.
    console.warn("[ig webhook] ai thread reply blocked:", sent.error);
    await logSendFailure(conv.id, channel.id, sent.error || "unknown error", tid);
    return;
  }
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${r.reply}`, source: "bot", tenantId: tid, channelId: channel.id });
  // Continue the thread: a reply to the AI's reply (or another follow-up) keeps going, one level deeper.
  await trackCommentWatch([sent.id, fu.commentId], { tenantId: tid, channelId: channel.id, platform: "instagram", rootCommentId: watch.rootCommentId, originalText: watch.originalText, replyText: r.reply, depth: watch.depth + 1 });
}

// Postback button taps (e.g. "I've followed ✅") arrive as messaging events.
async function handlePostback(channel: Channel, ev: Record<string, unknown>) {
  const senderId = String((ev.sender as Record<string, unknown>)?.id ?? "");
  const payload = String((ev.postback as Record<string, unknown>)?.payload ?? "");
  if (!senderId) return;
  if (payload.startsWith("FOLLOWCHK:")) {
    // Mirror the tap so the portal thread shows the user confirmed the follow
    // (a tap carries no text, so nothing else records it).
    const conv = await getOrCreateConversation(senderId, "", channel.id, "instagram", channel.tenantId);
    await appendConvMessage({ conversationId: conv.id, role: "user", body: "[comment] tapped “I've followed ✅”", source: "inbound", tenantId: channel.tenantId, channelId: channel.id }).catch(() => {});
    await resolveFollowGate(channel, senderId, payload.slice("FOLLOWCHK:".length));
  }
}

// Re-check follow and deliver the held reward or re-prompt. When Meta can't
// verify (null, pre-App-Review) we trust the tap so real followers aren't blocked.
// Every DM we send here is mirrored into the portal thread so Live Chat shows the
// full conversation (the reward link, not just the earlier follow prompt).
async function resolveFollowGate(channel: Channel, igsid: string, ruleId: string) {
  const tid = channel.tenantId;
  const rule = await getCommentRule(ruleId, tid);
  if (!rule) { await clearFollowGate(igsid, tid); return; }
  const creds = credsOf(channel);
  const follows = await getFollowStatus(creds, igsid);
  const now = new Date().toISOString();
  const conv = await getOrCreateConversation(igsid, "", channel.id, "instagram", tid);
  if (follows === false) {
    const reprompt = "I don't see a follow yet 👀 — tap Visit profile, hit Follow, then tap “I've followed”.";
    await sendIgButtons(creds, igsid, reprompt, await followButtons(channel, rule), { lastInboundAt: now });
    await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${reprompt}`, source: "bot", tenantId: tid, channelId: channel.id }).catch(() => {});
    return;
  }
  const buttons = rewardButtons(rule);
  const sent = buttons.length
    ? await sendIgButtons(creds, igsid, rule.dmMessage, buttons, { lastInboundAt: now })
    : await sendIgMessage(creds, igsid, rule.dmMessage, { lastInboundAt: now });
  if (sent.ok) {
    await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${rule.dmMessage}`, source: "bot", tenantId: tid, channelId: channel.id }).catch(() => {});
    await touchOutbound(conv.id, rule.dmMessage).catch(() => {});
    await clearFollowGate(igsid, tid); await bumpRuleMatch(rule.id, rule.matchCount, tid);
  } else {
    // They did the follow and got nothing — the gate stays set so they can retry,
    // but the thread must say why the reward never arrived.
    console.warn("[ig webhook] reward blocked:", sent.blockedBy, sent.error);
    await logSendFailure(conv.id, channel.id, sent.error || "unknown error", tid);
  }
}

function rewardButtons(rule: IgCommentRule): IgButton[] {
  // Up to 3 link buttons (Meta's button-template cap). Falls back to the legacy
  // single button for rules created before multi-button support.
  const list = rule.buttons?.length
    ? rule.buttons
    : rule.buttonUrl ? [{ label: rule.buttonLabel || "", url: rule.buttonUrl }] : [];
  return list.slice(0, 3).map(b => ({ type: "web_url", url: b.url, title: (b.label || "Open link").slice(0, 20) }));
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
