// ── Async grounding auditor (anti-hallucination L4) ──────────────────────────
// Runs AFTER the reply is already sent, so it adds ZERO latency to the customer.
// It catches what the deterministic firewall cannot: semantic / paraphrased
// fabrication that has no token signature ("best placements in India", "a job is
// guaranteed") and dropped parts of a multi-part question. A cheap one-shot LLM
// call (on the TENANT's own AI key) judges whether every brand claim in the reply
// is entailed by the retrieved context. On a confident negative it FLAGS the chat
// for a human (never disables the bot) and stops that answer from warming the
// cache. Always fail-open — any error (including a tenant with no AI key) leaves
// the already-sent reply and the conversation untouched.
//
// Modes (GROUNDING_AUDIT): "off" → never runs. "shadow" (default) → records every
// verdict but never flags/gates. "active" → also flags + blocks the cache.

import { runChat } from "../ai/chat";
import { resolveTenantAi } from "../ai/keys";
import { recordGroundingAudit, escalateConversation } from "../store";
import { DEFAULT_TENANT_ID } from "../tenant";

export type AuditMode = "off" | "shadow" | "active";
export function auditMode(): AuditMode {
  // Default OFF on the multi-tenant SaaS — the audit runs on each TENANT's own AI
  // key, so it must be an explicit operator opt-in, not an automatic cost. Set
  // GROUNDING_AUDIT=shadow to observe, =active to flag.
  const m = (process.env.GROUNDING_AUDIT || "off").toLowerCase();
  return m === "shadow" || m === "active" ? (m as AuditMode) : "off";
}

export interface AuditInput {
  tenantId?: string;
  conversationId: string;
  messageId?: string | null;
  question: string;
  reply: string;
  context: string;
  chunkSims?: number[];
  coverageBand?: string | null;
  topSim?: number | null;
  sanitizerActions?: unknown[];
}

export interface AuditVerdict { grounded: boolean; shouldCache: boolean }

const SYSTEM = [
  "You are a strict grounding auditor for a business's customer-support bot.",
  "Given the retrieved CONTEXT, the customer's QUESTION, and the bot's REPLY, judge:",
  "1) Is every BRAND-SPECIFIC claim in the REPLY (fees, dates, durations, course names, syllabus, placements, salary/% figures, guarantees, policies, contact details) supported by the CONTEXT? Greetings, general/educational knowledge, and offers to connect the customer with the team are ALWAYS grounded — they need no context.",
  "2) Did the REPLY address every part of a multi-part QUESTION?",
  "A claim with NO support in the CONTEXT is ungrounded. When unsure, lean towards grounded=true (avoid false alarms).",
  'Respond with JSON ONLY, no prose, no code fence: {"grounded": boolean, "unsupportedClaims": string[], "droppedSubquestions": string[], "confidence": number between 0 and 1}',
].join("\n");

function worthAuditing(reply: string): boolean {
  return reply.trim().length >= 40;   // skip greetings/acks — nothing to fabricate
}

// Tolerant JSON parse — providers sometimes wrap JSON in ```json fences or prose.
function parseVerdict(text: string): { grounded?: boolean; unsupportedClaims?: string[]; droppedSubquestions?: string[]; confidence?: number } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function auditReply(input: AuditInput): Promise<AuditVerdict | null> {
  const mode = auditMode();
  if (mode === "off") return null;
  const reply = (input.reply || "").trim();
  const question = (input.question || "").trim();
  if (!reply || !question || !worthAuditing(reply)) return null;
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;

  try {
    const ai = await resolveTenantAi(tenantId);   // throws if the tenant has no key → fail-open below
    const res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system: SYSTEM,
      turns: [{ role: "user", text: `QUESTION:\n${question}\n\nCONTEXT:\n${input.context?.trim() || "(no business context was retrieved)"}\n\nREPLY:\n${reply}` }],
      maxTokens: 512,
    });
    const parsed = parseVerdict(res.text ?? "");
    if (!parsed) return null;                                          // unparseable → fail-open
    const grounded = parsed.grounded !== false;                       // only an explicit false counts
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 1;
    const flagged = !grounded && confidence >= 0.6;

    const record = (g: boolean) => recordGroundingAudit({
      tenantId, conversationId: input.conversationId, messageId: input.messageId, question, reply,
      coverageBand: input.coverageBand, topSim: input.topSim,
      usedChunks: input.chunkSims?.length ?? 0, chunkSims: input.chunkSims,
      grounded: g, unsupportedClaims: parsed.unsupportedClaims ?? [], droppedSubquestions: parsed.droppedSubquestions ?? [],
      sanitizerActions: input.sanitizerActions ?? [], model: ai.model,
    });

    if (mode === "shadow") {
      await record(grounded);
      console.log(JSON.stringify({ tag: "grounding_audit", mode, grounded, confidence, flagged }));
      return { grounded, shouldCache: true };
    }
    if (flagged) {
      await record(false);
      await escalateConversation(input.conversationId);               // flags for a human; never disables the bot
      console.log(JSON.stringify({ tag: "grounding_audit", mode, grounded: false, confidence, flagged: true, conversationId: input.conversationId }));
    }
    return { grounded: !flagged, shouldCache: !flagged };
  } catch (err) {
    console.error("[grounding-audit] failed (fail-open):", err instanceof Error ? err.message : err);
    return null;
  }
}
