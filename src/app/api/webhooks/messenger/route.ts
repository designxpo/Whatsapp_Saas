export const maxDuration = 180;   // inline transcription + LLM reply — match WhatsApp so a slow turn isn't killed
import { NextResponse, after } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import { getChannelByPageId, effectiveAgentId, effectiveKbTag, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, touchOutbound, getConvHistory, addOptout, isOptedOut, escalateConversation, setConversationAvatar, setConversationComment, incAiReplies, claimWebhookEvent, getContactByPhone, setConversationLeadPhone, landCapturedLead, upsertContacts, logSendFailure, type Conversation } from "@/lib/store";
import { pushChatActivity, phoneFromAttributes, extractPhone, createOrUpdateLead } from "@/lib/leadsquared";
import { fetchLeadgen } from "@/lib/ads";
import { generateReply } from "@/lib/llm";
import { isAiEnabled } from "@/lib/messaging-settings";
import { downloadRemoteMedia, transcribeAudio } from "@/lib/voice";
import { uploadAudio, uploadMedia } from "@/lib/supabase";
import { sendFbMessage, getFbProfile, sendTypingOn, sendFbPrivateReply, replyToFbComment, likeFbComment, type FbCreds, type FbButton } from "@/lib/messenger";
import { matchCommentRule, claimComment, bumpRuleMatch } from "@/lib/fbcomments";
import { pickPublicReply } from "@/lib/igcomments";
import { getCommentWatch, trackCommentWatch, MAX_AI_THREAD_DEPTH, type CommentWatch } from "@/lib/commentthreads";
import { handleFlowMessage } from "@/lib/flowengine";
import { accountCanSend } from "@/lib/feature-guard";

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
      // Page changes: feed → post comments (comment-to-DM); leadgen → Instant Form leads.
      for (const change of (entry.changes as Record<string, unknown>[]) ?? []) {
        if (change.field === "leadgen") {
          try { await handleLeadgen(channel, change.value as Record<string, unknown>); }
          catch (e) { console.error("[fb webhook] leadgen", e); }
        } else if (change.field === "feed") {
          try { await handleComment(channel, change.value as Record<string, unknown>); }
          catch (e) { console.error("[fb webhook] comment", e); }
        }
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
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, source: "inbound", tenantId: channel.tenantId, channelId: channel.id, mediaUrl, mediaType });
  await touchInbound(conv.id, text || (mediaType?.startsWith("video/") ? "🎥 Video" : "📷 Photo"));   // opens / refreshes the 24h window
  // Capture a phone the lead types (Messenger has no number of its own) so the
  // chat can be matched to a CRM lead by phone — now and on later messages.
  if (!conv.leadPhone) {
    const shared = extractPhone(text);
    if (shared) {
      await setConversationLeadPhone(conv.id, shared).catch(() => undefined);
      conv = { ...conv, leadPhone: shared };
      // New number → a Contacts row tagged messenger; a returning lead → their
      // existing contact gains the tag and this chat picks up their known name.
      await landCapturedLead(conv.phone, shared, "messenger", channel.tenantId);
    }
  }
  if (text.trim()) after(() => syncFbToLsq(channel, conv, text, "inbound", "lead"));   // mirror to LeadSquared timeline

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

// An Instant-Form (Lead Ad) submission arrived. Fetch the answers and land the
// lead in the platform: create/enrich a Contact and mirror it to LeadSquared —
// exactly like a lead from any other channel. Never throws; idempotent (Meta
// redelivers leadgen events). Contacts are phone-keyed, so a phone is required.
async function handleLeadgen(channel: Channel, value: Record<string, unknown>) {
  const leadgenId = String(value?.leadgen_id ?? "");
  if (!leadgenId) return;
  if (!(await claimWebhookEvent(`leadgen:${leadgenId}`))) return;   // process once
  const lead = await fetchLeadgen(leadgenId, credsOf(channel).token);
  if (!lead) return;
  if (!lead.phone) { console.warn(`[leadgen] lead ${leadgenId} (form ${lead.formId}) has no phone — not stored (contacts are phone-keyed).`); return; }

  const attributes: Record<string, string> = { source: "Meta Lead Ad" };
  if (lead.formId) attributes.meta_form_id = lead.formId;
  if (value?.ad_id) attributes.ad_id = String(value.ad_id);
  if (lead.city) attributes.city = lead.city;
  await upsertContacts([{ phone: lead.phone, name: lead.fullName || undefined, email: lead.email || undefined, tags: ["meta-lead-ad"], attributes }], "meta_lead_ad", channel.tenantId).catch(() => {});
  await createOrUpdateLead({
    phone: lead.phone, name: lead.fullName || undefined, source: "Meta Lead Ad",
    fields: [
      ...(lead.email ? [{ Attribute: "EmailAddress", Value: lead.email }] : []),
      ...(lead.city ? [{ Attribute: "mx_City", Value: lead.city }] : []),
    ],
  }, channel.tenantId).catch(() => {});
}

// Mirror a Messenger message onto the lead's LeadSquared timeline. FB users have
// no phone, so the lead is matched by a phone shared in chat / captured by a flow
// (Messenger has no handle field). Never throws.
async function syncFbToLsq(channel: Channel, conv: Conversation, body: string, direction: "inbound" | "outbound", via: "lead" | "bot" | "agent") {
  try {
    const phone = conv.leadPhone || phoneFromAttributes((await getContactByPhone(conv.phone, channel.tenantId).catch(() => null))?.attributes);
    if (!phone) return;   // no phone to match a CRM lead — skip
    await pushChatActivity({ phone, direction, body, via, channel: "Messenger", tenantId: channel.tenantId, source: channel.crmSource || undefined });
  } catch { /* CRM sync must never break Messenger handling */ }
}

// Grounded AI responder. A direct DM (no commentId) replies in the DM and is
// uncapped. A comment-triggered reply (commentId set) posts PUBLICLY under the
// comment and is capped — after AI_REPLY_CAP replies (or when the model
// escalates) it sends a hand-off message and escalates to Live Chat for a human.
async function aiRespond(channel: Channel, conv: Conversation, userText: string, commentId?: string) {
  // Tenant-wide AI switch (Settings → AI auto-replies) — a human turned the AI off.
  if (!(await isAiEnabled(channel.tenantId))) return;
  const creds = credsOf(channel);
  const tid = channel.tenantId;
  const now = new Date().toISOString();
  const deliver = async (msg: string): Promise<boolean> => {
    const r = commentId ? await replyToFbComment(creds, commentId, msg, tid) : await sendFbMessage(creds, conv.phone, msg, { lastInboundAt: now });
    if (!r.ok) {
      console.warn("[fb webhook] ai reply blocked:", "blockedBy" in r ? r.blockedBy : undefined, r.error);
      await logSendFailure(conv.id, channel.id, r.error || "unknown error", tid);
    }
    return r.ok;
  };
  const closeOut = async () => {
    // Persist the handoff so Live Chat shows what the customer actually received
    // — the WhatsApp path does this; the Messenger path used to send it silently,
    // so the reply landed on the customer's phone but never in the portal thread.
    if (await deliver(CLOSING_MSG)) {
      await appendConvMessage({ conversationId: conv.id, role: "assistant", body: commentId ? `[comment] ${CLOSING_MSG}` : CLOSING_MSG, source: "bot", tenantId: tid, channelId: channel.id });
      await touchOutbound(conv.id, CLOSING_MSG);
    }
    await escalateConversation(conv.id);
  };

  // The cap applies to comment-triggered AI only; direct DMs stay uncapped.
  if (commentId && conv.aiReplyCount >= AI_REPLY_CAP) { await closeOut(); return; }
  if (!commentId) await sendTypingOn(creds, conv.phone);

  const history = await getConvHistory(conv.id, 20);
  // Conversation pin / flow-stamped KB tag → this Page's persona + allocated KB
  // → tenant-global (used to hardcode a null KB scope and skip the pin).
  // Direct DMs get the cross-channel cart (list/add/checkout) via the AI's
  // built-in commerce tools; public comment replies never sell.
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body.replace(/^\[comment\] /, ""), mediaUrl: h.mediaUrl, mediaType: h.mediaType })), conv.phone, effectiveAgentId(conv, channel), tid, effectiveKbTag(conv, channel), false, commentId ? undefined : { platform: "messenger", conversationId: conv.id });
  if (!r.reply || r.escalate) { await closeOut(); return; }

  if (!(await deliver(r.reply))) return;
  // Tag comment replies so Live Chat shows them as comment replies, not DMs.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: commentId ? `[comment] ${r.reply}` : r.reply, source: "bot", tenantId: tid, channelId: channel.id });
  await touchOutbound(conv.id, r.reply);
  const aiReply = r.reply;   // capture (closure loses the non-null narrowing)
  if (!commentId) after(() => syncFbToLsq(channel, conv, aiReply, "outbound", "bot"));   // DM AI replies → LeadSquared
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

  // AI takeover: a reply inside a thread a rule already answered → the AI responds
  // in context, instead of the canned rule firing again. Gated by the tenant AI switch.
  const parentId = String(value.parent_id ?? "") || null;
  if (parentId) {
    const watch = await getCommentWatch(parentId, tid);
    if (watch) {
      if (!(await claimComment(commentId, null, tid))) return;
      await aiThreadReply(channel, watch, { commentId, text, fromId, fromName });
      return;
    }
  }

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
    await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${text}`, source: "inbound", tenantId: tid, channelId: channel.id });
    await touchInbound(conv.id, `[comment] ${text}`);   // bump so the thread sorts to the top of Live Chat
    await aiRespond(channel, conv, text, commentId);
    return;
  }

  // Idempotency: claim the comment so a webhook redelivery can't double-DM.
  if (!(await claimComment(commentId, rule.id, tid))) return;

  // Record the comment in the portal's Comments tab. Previously a rule-matched
  // comment sent its DM silently and never appeared in the portal (only AI-handled
  // comments were stored), so the team couldn't see which comments fired a rule.
  const conv = await getOrCreateConversation(fromId, fromName, channel.id, "messenger", tid);
  await setConversationComment(conv.id, true);
  await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${text}`, source: "inbound", tenantId: tid, channelId: channel.id });
  await touchInbound(conv.id, `[comment] ${text}`);   // bump so the thread sorts to the top of Live Chat

  // The comment still gets claimed and shown in the portal above (so a tenant
  // who's fallen behind on billing can see what they're missing) — only the
  // actual outbound send is what stops, same failure-reporting shape as every
  // other blocked-send path in this function.
  if (!(await accountCanSend(tid))) {
    console.warn("[fb webhook] comment rule blocked: account not in good standing");
    await logSendFailure(conv.id, channel.id, "account not in good standing (trial expired, past due, or suspended)", tid);
    return;
  }

  const creds = credsOf(channel);

  // Reply-only rule: post a public reply (rotated) and send NO DM at all.
  if (rule.replyOnly) {
    const publicReply = pickPublicReply(rule);
    if (publicReply) {
      // replyToFbComment RETURNS { ok:false } on a rate cap / moderation block /
      // Graph error instead of throwing, so carry a reason on the thrown path too
      // and both failure shapes can be reported the same way.
      const res = await replyToFbComment(creds, commentId, publicReply, tid).catch(e => { console.error("[fb webhook] reply-only public reply", e); return { ok: false as const, error: e instanceof Error ? e.message : "Comment reply error" }; });
      if (res.ok) {
        await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${publicReply}`, source: "bot", tenantId: tid, channelId: channel.id });
        await bumpRuleMatch(rule.id, rule.matchCount, tid);
        await trackCommentWatch([commentId, res.id], { tenantId: tid, channelId: channel.id, platform: "messenger", rootCommentId: commentId, originalText: text, replyText: publicReply, depth: 0 });
      } else {
        // A reply-only rule sends no DM, so a failed public reply means the
        // commenter got NOTHING — surface it in the thread, not just the logs.
        console.warn("[fb webhook] reply-only public reply blocked:", res.error);
        await logSendFailure(conv.id, channel.id, res.error || "unknown error", tid);
      }
    }
    if (rule.likeComment) await likeFbComment(creds, commentId).catch(() => undefined);
    return;
  }

  // Up to 3 link buttons (Meta button-template cap); fall back to legacy single.
  const btnList = rule.buttons?.length ? rule.buttons : (rule.buttonUrl ? [{ label: rule.buttonLabel || "", url: rule.buttonUrl }] : []);
  const buttons: FbButton[] = btnList.slice(0, 3).map(b => ({ type: "web_url", url: b.url, title: (b.label || "Open link").slice(0, 20) }));
  const sent = await sendFbPrivateReply(creds, commentId, rule.dmMessage, buttons, tid);
  if (!sent.ok) {
    // The commenter gets nothing — record it in the thread like the AI path does,
    // so the portal shows WHY instead of the DM vanishing into the logs.
    console.warn("[fb webhook] comment DM blocked:", sent.blockedBy, sent.error);
    await logSendFailure(conv.id, channel.id, sent.error || "unknown error", tid);
    return;
  }

  // Mirror the automated DM into the portal thread so the team sees what was sent.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${rule.dmMessage}`, source: "bot", tenantId: tid, channelId: channel.id });
  await touchOutbound(conv.id, rule.dmMessage);

  await bumpRuleMatch(rule.id, rule.matchCount, tid);
  // Public reply: rotate a random variant so replies are never identical.
  const publicReply = pickPublicReply(rule);
  if (publicReply) {
    const pr = await replyToFbComment(creds, commentId, publicReply, tid).catch(e => { console.error("[fb webhook] public reply", e); return { ok: false as const, error: e instanceof Error ? e.message : "Comment reply error" }; });
    // The DM already landed (mirrored above), so no "not delivered" note here —
    // only the public reply is missing, and with it this thread's AI-takeover watch.
    if (pr.ok) await trackCommentWatch([commentId, pr.id], { tenantId: tid, channelId: channel.id, platform: "messenger", rootCommentId: commentId, originalText: text, replyText: publicReply, depth: 0 });
    else console.warn("[fb webhook] public reply blocked:", pr.error);
  }
  if (rule.likeComment) await likeFbComment(creds, commentId).catch(() => undefined);
}

// A follow-up landed in a thread a rule opened → the AI answers it in context,
// grounded in the Page's persona + KB. Capped by depth + the 60/hr reply limiter;
// never fires on our own comments (guarded in handleComment).
async function aiThreadReply(channel: Channel, watch: CommentWatch, fu: { commentId: string; text: string; fromId: string; fromName: string }) {
  const tid = channel.tenantId;
  if (!(await isAiEnabled(tid))) return;
  if (watch.depth >= MAX_AI_THREAD_DEPTH) return;   // anti-runaway cap
  const creds = credsOf(channel);
  const conv = await getOrCreateConversation(fu.fromId, fu.fromName, channel.id, "messenger", tid);
  await setConversationComment(conv.id, true);
  if (!conv.botEnabled) return;   // a human is handling this thread
  await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${fu.text}`, source: "inbound", tenantId: tid, channelId: channel.id });
  await touchInbound(conv.id, `[comment] ${fu.text}`);   // bump so the thread sorts to the top of Live Chat
  const history = [
    { role: "user" as const, body: watch.originalText, mediaUrl: null, mediaType: null },
    { role: "assistant" as const, body: watch.replyText, mediaUrl: null, mediaType: null },
    { role: "user" as const, body: fu.text, mediaUrl: null, mediaType: null },
  ].filter(h => h.body);
  const r = await generateReply(history, conv.phone, effectiveAgentId(conv, channel), tid, effectiveKbTag(conv, channel), false, undefined);
  if (!r.reply || r.escalate) return;
  const sent = await replyToFbComment(creds, watch.rootCommentId, r.reply, tid);
  if (!sent.ok) {
    // The follow-up got no answer — say why in the thread, like the AI DM path does.
    console.warn("[fb webhook] ai thread reply blocked:", sent.error);
    await logSendFailure(conv.id, channel.id, sent.error || "unknown error", tid);
    return;
  }
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: `[comment] ${r.reply}`, source: "bot", tenantId: tid, channelId: channel.id });
  await trackCommentWatch([sent.id, fu.commentId], { tenantId: tid, channelId: channel.id, platform: "messenger", rootCommentId: watch.rootCommentId, originalText: watch.originalText, replyText: r.reply, depth: watch.depth + 1 });
}
