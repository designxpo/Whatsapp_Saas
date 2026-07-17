import {
  getConversation, getConvHistory, appendConvMessage, touchOutbound, setConversationStatus,
  claimReply, reflagReply, isOptedOut, dailySentCount,
} from "./store";
import { generateReply } from "./llm";
import { isAiEnabled } from "./messaging-settings";
import { sendText, sendCtaUrl, sendMedia } from "./whatsapp";
import { getVoiceReplyMode, shouldSpeak, synthesizeSpeech, visionInlineMime } from "./voice";
import type { ChannelCreds } from "./channels";
import { pushWaActivity } from "./leadsquared";
import { emitEvent } from "./integrations";
import { routeMessage, recordRagAnswer } from "./router";
import { auditReply } from "./guard/audit";
import { isAutoRouteEnabled, pickAgentForQuery } from "./aihub";
import { embedQuery } from "./kb";
import { setConversationAgent } from "./store";
import { getChannel, effectiveAgentId, effectiveKbTag, type Channel } from "./channels";
import { getDailyCap } from "./quota";
import { hasActiveDripEnrollment } from "./sequences";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type RespondOutcome = "sent" | "escalated" | "skipped" | "failed";

// ── Smart send: answers that reference a link get a tappable URL button ──────
// An explicit "talk to a human" request. Kept tight (a clear request to reach a
// person), so normal questions that merely contain "support"/"agent" don't trip
// it. Used to route straight to a human before any FAQ/cache/AI answer.
const HUMAN_REQUEST_RE = /\b(?:(?:talk|speak|chat|connect|transfer)\s+(?:(?:to|with|me)\s+)*(?:a\s+|an\s+|the\s+)?(?:human|agent|person|someone|representative|executive|counsell?or|advisor|team\s+member|live\s+agent)|(?:human|live|real)\s+(?:agent|person|support)|customer\s+care|call\s+me\s+back)\b/i;

const URL_RE = /https?:\/\/[^\s)\]>"']+/;

function linkButtonLabel(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("brochure") || u.endsWith(".pdf")) return "View brochure";
  if (u.includes("course") || u.includes("program")) return "View courses";
  if (u.includes("menu")) return "View menu";
  if (u.includes("property") || u.includes("listing") || u.includes("project")) return "View listing";
  if (u.includes("package") || u.includes("itinerary") || u.includes("tour")) return "View packages";
  if (u.includes("product") || u.includes("shop") || u.includes("catalog") || u.includes("store")) return "Shop now";
  if (u.includes("pricing") || u.includes("plans")) return "View pricing";
  if (u.includes("book") || u.includes("appointment") || u.includes("schedule")) return "Book now";
  if (u.includes("contact") || u.includes("wa.me")) return "Contact us";
  if (u.includes("apply") || u.includes("enroll") || u.includes("register")) return "Apply now";
  return "View details";
}

// The AI includes relevant KB links as bare URLs; turn the first one into a
// WhatsApp CTA button (cleaner + tappable). Falls back to plain text.
async function sendSmart(phone: string, text: string, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const m = text.match(URL_RE);
  if (m) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const body = text.replace(m[0], "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (body) {
      const r = await sendCtaUrl(phone, body, linkButtonLabel(url), url, channel);
      if (!r.error) return r;          // cta failed (rare) → plain text below
    }
  }
  return sendText(phone, text, channel);
}

// Produces and sends one AI reply for a conversation. Safe to call from both the
// fire-and-forget worker and the cron sweep — claimReply ensures only one wins.
export async function respondToConversation(conversationId: string, opts: { inboundWasVoice?: boolean } = {}): Promise<{ outcome: RespondOutcome; detail?: string }> {
  const conv = await getConversation(conversationId);
  if (!conv) return { outcome: "skipped", detail: "no conversation" };

  // Gating: global kill switch + the per-conversation bot toggle.
  // NOTE: an "escalated" chat is NO LONGER silenced. Escalation only FLAGS the chat
  // for a human; the bot keeps answering so the customer is never left waiting. The
  // moment a human replies (Team Inbox / CRM), bot_enabled flips off and the bot
  // steps aside. We only skip when the bot is explicitly off for this chat, or the
  // chat is paused.
  if (process.env.LLM_BOT_ENABLED === "false") return { outcome: "skipped", detail: "bot disabled" };
  // Tenant-wide AI switch (Settings → AI auto-replies) — a human turned the AI off.
  if (!(await isAiEnabled(conv.tenantId))) return { outcome: "skipped", detail: "AI replies switched off" };
  if (!conv.botEnabled || conv.status === "paused") return { outcome: "skipped", detail: `bot off / ${conv.status}` };

  // 24h customer-service window — free-form text only allowed within it.
  if (!conv.lastInboundAt || Date.now() - new Date(conv.lastInboundAt).getTime() > WINDOW_MS) {
    return { outcome: "skipped", detail: "outside 24h window" };
  }

  // Opt-out suppression + daily cap (parallel — independent reads).
  // Both MUST be scoped to the conversation's tenant: a STOP sent to tenant B's
  // number lives in tenant B's wa_optouts, so calling optoutSet() with no arg
  // (which defaults to DEFAULT_TENANT_ID) would silently ignore the opt-out for
  // every non-owner tenant — a consent/compliance bug.
  const [optedOut, sentToday, dailyCap, inSequence] = await Promise.all([isOptedOut(conv.phone, conv.tenantId), dailySentCount(conv.tenantId), getDailyCap(conv.tenantId, conv.channelId), hasActiveDripEnrollment(conv.phone, conv.tenantId)]);
  if (optedOut) return { outcome: "skipped", detail: "opted out" };
  if (sentToday >= dailyCap) return { outcome: "skipped", detail: "daily cap reached" };
  // A sequence is driving this contact → let the drip own the thread, no AI reply.
  if (inSequence) return { outcome: "skipped", detail: "in active sequence" };

  // Claim — only one runner proceeds.
  if (!(await claimReply(conversationId))) return { outcome: "skipped", detail: "already claimed" };

  try {
    const history = await getConvHistory(conversationId, 20);

    // Reply from the number this conversation lives on (env creds when unset),
    // and prefer that number's default AI persona when the chat has no pin.
    const channel: Channel | undefined = conv.channelId ? (await getChannel(conv.channelId)) ?? undefined : undefined;
    const lastUser = [...history].reverse().find(m => m.role === "user");
    const lastUserMsg = lastUser?.body ?? "";
    // When the newest message is a file the AI can SEE (image / PDF / video),
    // bypass the text-only Knowledge Router (FAQ + semantic cache) — the answer
    // depends on the file's contents, so it must go straight to the multimodal
    // model, and must never be served from (or written to) the text cache.
    const lastHasMedia = !!lastUser?.mediaUrl && !!visionInlineMime(lastUser.mediaType);

    // ── Explicit human-handoff request → route straight to a person, BEFORE the
    // FAQ/cache/AI layers. So "Talk to agent" always reaches a human instead of
    // being answered by a cached reply or restarting the qualification flow.
    if (HUMAN_REQUEST_RE.test(lastUserMsg)) {
      await setConversationStatus(conversationId, "escalated");
      void emitEvent(conv.tenantId, "conversation.escalated", { conversationId, phone: conv.phone, name: conv.name, reason: "human requested", channel: conv.platform });
      const handoff = "I've flagged this for our team — someone will follow up with you here. In the meantime, I'm happy to keep helping with any questions! 🙌";
      const sent = await sendText(conv.phone, handoff, channel);
      if (sent.id) {
        await appendConvMessage({ conversationId, role: "assistant", body: handoff, metaId: sent.id, source: "bot", tenantId: conv.tenantId, channelId: conv.channelId ?? null });
        await touchOutbound(conversationId, handoff);
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: handoff, via: "bot", tenantId: conv.tenantId });
      }
      return { outcome: "escalated", detail: "human requested" };
    }

    // Voice reply: speak the answer when the workspace wants it ("always", or
    // "mirror" the customer when they sent a voice note). WhatsApp only; falls
    // back to a text message whenever speech synthesis isn't available/configured.
    const voiceMode = await getVoiceReplyMode(conv.tenantId).catch(() => "off" as const);
    const speakReply = conv.platform !== "instagram" && shouldSpeak(voiceMode, !!opts.inboundWasVoice);
    const sendReply = async (body: string): Promise<{ id?: string; error?: string }> => {
      if (speakReply) {
        const v = await synthesizeSpeech(body, conv.tenantId);
        if (v) return sendMedia(conv.phone, "audio", v.url, undefined, channel);
      }
      return sendSmart(conv.phone, body, channel);
    };

    // ── Auto agent routing FIRST — every message, before any answer layer, so
    // FAQ/cache replies also speak in the right persona and the conversation
    // switches the moment the topic changes. One embedding call, reused by the
    // semantic-cache layer below.
    let agentId = effectiveAgentId(conv, channel);
    // KB scope for this reply: flow-stamped conversation tag → the channel's
    // allocated KB → the tenant's whole KB. Threaded through the router (cache
    // suppression), RAG retrieval, and the cache write below so a channel-scoped
    // answer can never leak into (or out of) the tenant's semantic cache.
    const kbTag = effectiveKbTag(conv, channel);
    let queryEmbedding: number[] | null = null;
    try {
      if (lastUserMsg && await isAutoRouteEnabled(conv.tenantId)) {
        queryEmbedding = await embedQuery(lastUserMsg).catch(() => null);
        if (queryEmbedding) {
          const pick = await pickAgentForQuery(queryEmbedding, agentId, conv.tenantId);
          if (pick && pick.agentId !== agentId) {
            await setConversationAgent(conversationId, pick.agentId);
            agentId = pick.agentId;
            console.log(JSON.stringify({ tag: "agent_route", conversationId, to: pick.name, score: Number(pick.score.toFixed(3)) }));
          }
        }
      }
    } catch (e) { console.error("[assistant] auto-route:", e); }

    // ── Knowledge Router: memory → FAQ → semantic cache. RAG only on miss. ──
    if (lastUserMsg && !lastHasMedia) {
      const routed = await routeMessage({ conversationId, phone: conv.phone, message: lastUserMsg, agentId, queryEmbedding, tenantId: conv.tenantId, contactName: conv.name, primaryKbTag: kbTag });
      queryEmbedding = routed.queryEmbedding ?? queryEmbedding;
      if (routed.answer) {
        const sent = await sendReply(routed.answer);
        if (sent.error) { await reflagReply(conversationId); return { outcome: "failed", detail: sent.error }; }
        await appendConvMessage({ conversationId, role: "assistant", body: routed.answer, metaId: sent.id, source: "bot", tenantId: conv.tenantId, channelId: conv.channelId ?? null });
        await touchOutbound(conversationId, routed.answer);
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: routed.answer, via: "bot", tenantId: conv.tenantId });
        return { outcome: "sent", detail: `router:${routed.source}` };
      }
    }

    // ── RAG + agent persona + function-calling pipeline ──
    // Resolution: auto-routed/pinned agent → globally active agent.
    const result = await generateReply(history, conv.phone, agentId, conv.tenantId, kbTag);

    if (result.escalate || !result.reply) {
      await setConversationStatus(conversationId, "escalated");
      // Notify any connected integrations (Slack/Teams/Zapier) that a human is
      // needed — best-effort, must never delay or fail the handoff reply.
      void emitEvent(conv.tenantId, "conversation.escalated", { conversationId, phone: conv.phone, name: conv.name, reason: result.reason ?? null, channel: conv.platform });
      // A function handoff supplies its own reply text; otherwise use the default.
      const handoff = result.reply ?? "Thanks for reaching out — I've flagged this for our team to follow up. Meanwhile, I'm happy to keep helping — what would you like to know?";
      const sent = await sendText(conv.phone, handoff, channel);
      if (sent.id) {
        await appendConvMessage({ conversationId, role: "assistant", body: handoff, metaId: sent.id, source: "bot", tenantId: conv.tenantId, channelId: conv.channelId ?? null });
        await touchOutbound(conversationId, handoff);
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: handoff, via: "bot", tenantId: conv.tenantId });
      }
      return { outcome: "escalated", detail: result.reason };
    }

    const sent = await sendReply(result.reply);
    if (sent.error) { await reflagReply(conversationId); return { outcome: "failed", detail: sent.error }; }
    // Persist the reply WITH its grounding telemetry (coverage band + what the
    // firewall stripped/deferred) so KB gaps are visible after the fact.
    const saved = await appendConvMessage({
      conversationId, role: "assistant", body: result.reply, metaId: sent.id, source: "bot", tenantId: conv.tenantId, channelId: conv.channelId ?? null,
      coverageBand: result.coverageBand, topSim: result.topSim,
      groundingDeferred: result.groundingActions?.some(a => a.disposition === "defer"),
      groundingStripped: result.groundingActions,
    });
    await touchOutbound(conversationId, result.reply);
    void pushWaActivity({ phone: conv.phone, direction: "outbound", body: result.reply, via: "bot", tenantId: conv.tenantId });
    // Async semantic grounding audit — the reply is ALREADY sent, so this is off
    // the customer's hot path. Catches claims the firewall can't, on the tenant's
    // own AI key, and gates the cache so a flagged answer is never reused. The
    // conversation is unaffected on any error (incl. a tenant with no AI key).
    if (lastUserMsg && !lastHasMedia) {
      const verdict = await auditReply({
        tenantId: conv.tenantId, conversationId, messageId: saved?.id, question: lastUserMsg, reply: result.reply,
        context: result.context ?? "", chunkSims: result.chunkSims, coverageBand: result.coverageBand,
        topSim: result.topSim, sanitizerActions: result.groundingActions,
      }).catch(() => null);
      if (!verdict || verdict.shouldCache) {
        recordRagAnswer({ phone: conv.phone, question: lastUserMsg, answer: result.reply, queryEmbedding, tenantId: conv.tenantId, contactName: conv.name, primaryKbTag: kbTag });
      }
    }
    return { outcome: "sent" };
  } catch (err) {
    await reflagReply(conversationId);
    return { outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
