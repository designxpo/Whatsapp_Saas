import {
  getConversation, getConvHistory, appendConvMessage, touchOutbound, setConversationStatus,
  claimReply, reflagReply, optoutSet, dailySentCount,
} from "./store";
import { generateReply } from "./llm";
import { sendText, sendCtaUrl } from "./whatsapp";
import type { ChannelCreds } from "./channels";
import { pushWaActivity } from "./leadsquared";
import { emitEvent } from "./integrations";
import { routeMessage, recordRagAnswer } from "./router";
import { isAutoRouteEnabled, pickAgentForQuery } from "./aihub";
import { embedQuery } from "./kb";
import { setConversationAgent } from "./store";
import { getChannel, type Channel } from "./channels";

const WINDOW_MS = 24 * 60 * 60 * 1000;
function dailyLimit(): number { return parseInt(process.env.WA_DAILY_LIMIT ?? "900", 10); }
const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

export type RespondOutcome = "sent" | "escalated" | "skipped" | "failed";

// ── Smart send: answers that reference a link get a tappable URL button ──────
const URL_RE = /https?:\/\/[^\s)\]>"']+/;

function linkButtonLabel(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("brochure") || u.endsWith(".pdf")) return "View brochure";
  if (u.includes("course") || u.includes("program")) return "View courses";
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
export async function respondToConversation(conversationId: string): Promise<{ outcome: RespondOutcome; detail?: string }> {
  const conv = await getConversation(conversationId);
  if (!conv) return { outcome: "skipped", detail: "no conversation" };

  // Gating: global kill switch, per-conversation toggle, status, and bot ownership.
  if (process.env.LLM_BOT_ENABLED === "false") return { outcome: "skipped", detail: "bot disabled" };
  if (!conv.botEnabled || conv.status !== "active") return { outcome: "skipped", detail: `status ${conv.status}` };

  // 24h customer-service window — free-form text only allowed within it.
  if (!conv.lastInboundAt || Date.now() - new Date(conv.lastInboundAt).getTime() > WINDOW_MS) {
    return { outcome: "skipped", detail: "outside 24h window" };
  }

  // Opt-out suppression + daily cap (parallel — independent reads).
  // Both MUST be scoped to the conversation's tenant: a STOP sent to tenant B's
  // number lives in tenant B's wa_optouts, so calling optoutSet() with no arg
  // (which defaults to DEFAULT_TENANT_ID) would silently ignore the opt-out for
  // every non-owner tenant — a consent/compliance bug.
  const [optouts, sentToday] = await Promise.all([optoutSet(conv.tenantId), dailySentCount(conv.tenantId)]);
  if (optouts.has(last10(conv.phone))) return { outcome: "skipped", detail: "opted out" };
  if (sentToday >= dailyLimit()) return { outcome: "skipped", detail: "daily cap reached" };

  // Claim — only one runner proceeds.
  if (!(await claimReply(conversationId))) return { outcome: "skipped", detail: "already claimed" };

  try {
    const history = await getConvHistory(conversationId, 20);

    // Reply from the number this conversation lives on (env creds when unset),
    // and prefer that number's default AI persona when the chat has no pin.
    const channel: Channel | undefined = conv.channelId ? (await getChannel(conv.channelId)) ?? undefined : undefined;
    const lastUserMsg = [...history].reverse().find(m => m.role === "user")?.body ?? "";

    // ── Auto agent routing FIRST — every message, before any answer layer, so
    // FAQ/cache replies also speak in the right persona and the conversation
    // switches the moment the topic changes. One embedding call, reused by the
    // semantic-cache layer below.
    let agentId = conv.agentId ?? channel?.agentId ?? null;
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
    if (lastUserMsg) {
      const routed = await routeMessage({ conversationId, phone: conv.phone, message: lastUserMsg, agentId, queryEmbedding, tenantId: conv.tenantId });
      queryEmbedding = routed.queryEmbedding ?? queryEmbedding;
      if (routed.answer) {
        const sent = await sendSmart(conv.phone, routed.answer, channel);
        if (sent.error) { await reflagReply(conversationId); return { outcome: "failed", detail: sent.error }; }
        await appendConvMessage({ conversationId, role: "assistant", body: routed.answer, metaId: sent.id, source: "bot" });
        await touchOutbound(conversationId, routed.answer);
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: routed.answer, via: "bot", tenantId: conv.tenantId });
        return { outcome: "sent", detail: `router:${routed.source}` };
      }
    }

    // ── RAG + agent persona + function-calling pipeline ──
    // Resolution: auto-routed/pinned agent → globally active agent.
    const result = await generateReply(history, conv.phone, agentId, conv.tenantId, conv.primaryKbTag);

    if (result.escalate || !result.reply) {
      await setConversationStatus(conversationId, "escalated");
      // Notify any connected integrations (Slack/Teams/Zapier) that a human is
      // needed — best-effort, must never delay or fail the handoff reply.
      void emitEvent(conv.tenantId, "conversation.escalated", { conversationId, phone: conv.phone, name: conv.name, reason: result.reason ?? null, channel: conv.platform });
      // A function handoff supplies its own reply text; otherwise use the default.
      const handoff = result.reply ?? "Thanks for reaching out — I'm connecting you with a team member who'll reply shortly.";
      const sent = await sendText(conv.phone, handoff, channel);
      if (sent.id) {
        await appendConvMessage({ conversationId, role: "assistant", body: handoff, metaId: sent.id, source: "bot" });
        await touchOutbound(conversationId, handoff);
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: handoff, via: "bot", tenantId: conv.tenantId });
      }
      return { outcome: "escalated", detail: result.reason };
    }

    const sent = await sendSmart(conv.phone, result.reply, channel);
    if (sent.error) { await reflagReply(conversationId); return { outcome: "failed", detail: sent.error }; }
    await appendConvMessage({ conversationId, role: "assistant", body: result.reply, metaId: sent.id, source: "bot" });
    await touchOutbound(conversationId, result.reply);
    void pushWaActivity({ phone: conv.phone, direction: "outbound", body: result.reply, via: "bot", tenantId: conv.tenantId });
    // Warm the semantic cache so the next similar question skips RAG.
    if (lastUserMsg) recordRagAnswer({ phone: conv.phone, question: lastUserMsg, answer: result.reply, queryEmbedding, tenantId: conv.tenantId });
    return { outcome: "sent" };
  } catch (err) {
    await reflagReply(conversationId);
    return { outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
