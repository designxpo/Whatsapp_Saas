export const maxDuration = 60;
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getChannelByIgId, type Channel } from "@/lib/channels";
import { getOrCreateConversation, appendConvMessage, touchInbound, getConvHistory, addOptout, optoutSet, incAiReplies, escalateConversation, type Conversation } from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { sendIgMessage, sendPrivateReply, sendIgButtons, replyToComment, within24hWindow, getIgProfile, getFollowStatus, type IgCreds, type IgButton } from "@/lib/instagram";
import { getSequenceByTrigger, enroll } from "@/lib/sequences";
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

// Inbound DM → conversation + grounded in-window AI reply.
async function handleMessage(channel: Channel, ev: Record<string, unknown>) {
  const senderId = String((ev.sender as Record<string, unknown>)?.id ?? "");
  const msg = ev.message as Record<string, unknown> | undefined;
  const text = (msg?.text as string) ?? "";
  // Ignore echoes (our own outbound) and non-text events.
  if (!senderId || !text.trim() || (msg?.is_echo as boolean)) return;

  // Opt-out (STOP) honored like WhatsApp.
  if (OPTOUT_RE.test(text)) { await addOptout(senderId, "ig stop", channel.tenantId); return; }
  if ((await optoutSet(channel.tenantId)).has(senderId.slice(-10))) return;

  let conv = await getOrCreateConversation(senderId, "", channel.id, "instagram", channel.tenantId);
  // Webhooks only carry the IGSID — resolve the @handle once (while unnamed).
  if (!conv.name) {
    const prof = await getIgProfile(credsOf(channel), senderId);
    const display = prof.username ? `@${prof.username}` : prof.name;
    if (display) conv = await getOrCreateConversation(senderId, display, channel.id, "instagram", channel.tenantId);
  }
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, source: "inbound", tenantId: channel.tenantId });
  await touchInbound(conv.id, text);   // opens / refreshes the 24-hour window

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

  if (!conv.botEnabled) return;

  // Chatbot flows (platform='instagram') run first; AI is the fallback.
  const flowHandled = await handleFlowMessage(conv.id, senderId, text, { channel }).catch(() => false);
  if (flowHandled) return;

  await aiRespond(channel, conv, text);
}

// Shared AI responder with a per-conversation cap. Generates a grounded reply;
// after AI_REPLY_CAP replies (or when the model escalates) it sends a hand-off
// message and escalates the conversation to the portal (Live Chat, needs human).
// `commentId` set → first contact is the one-time private reply + a public reply.
async function aiRespond(channel: Channel, conv: Conversation, userText: string, commentId?: string) {
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

  const history = await getConvHistory(conv.id, 20);
  const r = await generateReply(history.map(h => ({ role: h.role, body: h.body.replace(/^\[comment\] /, "") })), conv.phone, channel.agentId, tid);
  if (!r.reply || r.escalate) { await closeOut(); return; }

  if (!(await deliver(r.reply))) return;
  // Tag comment replies so Live Chat shows them as comment replies, not DMs.
  await appendConvMessage({ conversationId: conv.id, role: "assistant", body: commentId ? `[comment] ${r.reply}` : r.reply, source: "bot", tenantId: tid });
  if (commentId) await incAiReplies(conv.id, conv.aiReplyCount);
}

// Comment → ManyChat-style automation. Matches the comment against this tenant's
// rules (account + per-post + keyword), then sends ONE private DM (the comment
// is the opt-in; Meta allows a single private reply per comment), optionally
// behind a follow gate, with a link button + optional public reply.
async function handleComment(channel: Channel, value: Record<string, unknown>) {
  const commentId = String(value.id ?? "");
  const text = String(value.text ?? "");
  const fromId = String((value.from as Record<string, unknown>)?.id ?? "");
  const mediaId = String((value.media as Record<string, unknown>)?.id ?? "") || null;
  if (!commentId || !text) return;
  if (fromId && channel.igUserId && fromId === channel.igUserId) return;   // never reply to ourselves

  const tid = channel.tenantId;
  const rule = await matchCommentRule(text, mediaId, tid, channel.id);

  // No fixed rule matched → let the AI answer the comment contextually (public
  // reply + DM), capped + escalating to a human after AI_REPLY_CAP replies.
  if (!rule) {
    if (!(await claimComment(commentId, null, tid))) return;
    let conv = await getOrCreateConversation(fromId, "", channel.id, "instagram", tid);
    if (!conv.name) {
      const prof = await getIgProfile(credsOf(channel), fromId);
      const display = prof.username ? `@${prof.username}` : prof.name;
      if (display) conv = await getOrCreateConversation(fromId, display, channel.id, "instagram", tid);
    }
    if (!conv.botEnabled) return;   // a human is handling this thread
    // Marker so Live Chat shows this came from a COMMENT, not a DM.
    await appendConvMessage({ conversationId: conv.id, role: "user", body: `[comment] ${text}`, source: "inbound", tenantId: tid });
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
