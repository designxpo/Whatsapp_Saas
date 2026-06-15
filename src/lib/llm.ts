import { retrieve } from "./kb";
import { resolveAgent, listFunctions, executeAiFunction, isToneEnabled, type AiFunction } from "./aihub";
import { runChat, type ChatTool, type ChatTurn } from "./ai/chat";
import { resolveTenantAi, AiKeyMissingError } from "./ai/keys";

// Below this cosine similarity, retrieved context is treated as irrelevant.
const MIN_SIMILARITY = 0.45;
const ESCALATE_TOKEN = "[[ESCALATE]]";
const MAX_TOOL_ROUNDS = 3;

export const FALLBACK_REPLY =
  "Thanks for your message! A team member will get back to you shortly.";

// AI Hub functions → normalized chat tools (provider-agnostic).
function toChatTools(fns: AiFunction[]): ChatTool[] | undefined {
  if (fns.length === 0) return undefined;
  return fns.map(f => ({
    name: f.name,
    description: f.description || f.name,
    params: f.parameters.map(p => ({ name: p.name, description: p.description || p.name })),
    required: f.parameters.filter(p => p.required).map(p => p.name),
  }));
}

// System prompt assembly: active AI Hub agent persona/constraints/product info
// (falling back to BOT_SYSTEM_PROMPT env, then a safe default) + RAG context.
function systemPrompt(context: string, agent: { persona: string; constraintsText: string; productInfo: string } | null, hasTools: boolean): string {
  const persona = agent?.persona?.trim() || process.env.BOT_SYSTEM_PROMPT?.trim() || [
    "You are a helpful WhatsApp assistant for a business.",
    "Reply in a warm, concise, professional tone suited to WhatsApp — short paragraphs, no markdown headings.",
  ].join("\n");

  const parts = [persona];
  if (agent?.constraintsText?.trim()) parts.push(`--- Constraints ---\n${agent.constraintsText.trim()}`);
  if (agent?.productInfo?.trim()) parts.push(`--- Product & service information ---\n${agent.productInfo.trim()}`);
  parts.push([
    "--- Grounding rules ---",
    "Answer factual questions ONLY using the Business context below. Do not invent facts, prices, policies, or availability.",
    hasTools
      ? "When you have collected the details a function needs (per its description), CALL the function. You may keep conversing when context is missing — collecting details does not require business context."
      : "",
    `If you cannot help, or the user demands a human/agent, or it is a complaint or sensitive issue, reply with exactly ${ESCALATE_TOKEN} and nothing else.`,
    "Never promise anything not supported by the context. No medical, legal, or financial advice.",
  ].filter(Boolean).join("\n"));
  parts.push([
    "--- WhatsApp formatting (always) ---",
    "• Keep replies under ~120 words, in short 1–2 line paragraphs.",
    "• When listing 2+ items (courses, steps, options), put each on its own line starting with the • character. Use *asterisks* to bold key terms like course names or prices.",
    "• When the Business context contains a relevant URL (course page, brochure, contact), include it as a bare link on its own line — never markdown [text](url).",
    "• Never prefix replies with your name, role, or labels (no 'SUPPORT:', no 'Maya:'). Just speak naturally.",
    "• End with one short, helpful follow-up question when it moves the conversation forward.",
  ].join("\n"));
  parts.push(`--- Business context ---\n${context || "(no relevant context found)"}`);
  return parts.join("\n\n");
}

export interface ReplyResult {
  reply: string | null;     // null when escalating
  escalate: boolean;
  reason?: string;
  usedChunks: number;
  functionCalls?: string[]; // names of AI functions executed this turn
}

// Generates a grounded reply from conversation history. `history` must end with
// the user's latest message. `phone` enables function-calling attribute capture.
// `agentId` pins a specific agent (conversation routing); null → active agent.
export async function generateReply(history: { role: "user" | "assistant"; body: string }[], phone?: string, agentId?: string | null, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<ReplyResult> {
  const lastUser = [...history].reverse().find(m => m.role === "user");
  if (!lastUser) return { reply: null, escalate: true, reason: "no user message", usedChunks: 0 };

  // Agent persona + function tools (both optional — defaults preserve old behavior).
  const [agent, functions] = await Promise.all([
    resolveAgent(agentId, tenantId).catch(() => null),
    listFunctions(true, tenantId).catch(() => [] as Awaited<ReturnType<typeof listFunctions>>),
  ]);
  const tools = toChatTools(functions);

  // Retrieve business context for the latest question.
  let chunks: { content: string; similarity: number }[] = [];
  try {
    chunks = await retrieve(lastUser.body, 6, tenantId);
  } catch (err) {
    console.error("[llm] retrieve failed:", err);
  }
  const relevant = chunks.filter(c => c.similarity >= MIN_SIMILARITY);

  // No relevant knowledge AND no agent/tools to carry the conversation → escalate.
  if (relevant.length === 0 && !agent && functions.length === 0) {
    return { reply: null, escalate: true, reason: "no relevant context", usedChunks: 0 };
  }

  const context = relevant.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");
  const system = systemPrompt(context, agent, !!tools);

  // Resolve the tenant's OWN chat provider + key (agent.model wins if pinned).
  // Require-own-key: no key → AI is off for this tenant, so escalate to a human.
  let ai;
  try {
    ai = await resolveTenantAi(tenantId, agent?.model ?? null);
  } catch (err) {
    if (err instanceof AiKeyMissingError) {
      return { reply: null, escalate: true, reason: "no AI key configured", usedChunks: relevant.length };
    }
    throw err;
  }

  const turns: ChatTurn[] = history.map((m): ChatTurn =>
    m.role === "assistant" ? { role: "assistant", text: m.body } : { role: "user", text: m.body });

  try {
    let escalateViaFn = false;
    const executed: string[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await runChat({ provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system, turns, tools, maxTokens: 1024 });

      // Function-calling round: execute each call, feed results back, continue.
      if (res.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
        turns.push({ role: "assistant", calls: res.toolCalls });
        const results = [];
        for (const c of res.toolCalls) {
          const fn = functions.find(f => f.name === c.name);
          const result = fn
            ? await executeAiFunction(fn, c.args, phone, tenantId)
            : { status: "unknown function", escalate: false };
          if (result.escalate) escalateViaFn = true;
          if (fn) executed.push(fn.name);
          results.push({ id: c.id, name: c.name, status: result.status });
        }
        turns.push({ role: "tool", results });
        continue;
      }

      const text = res.text;
      if (!text || text.includes(ESCALATE_TOKEN)) {
        return { reply: null, escalate: true, reason: "model escalated", usedChunks: relevant.length, functionCalls: executed };
      }
      return { reply: text, escalate: escalateViaFn, reason: escalateViaFn ? "function handoff" : undefined, usedChunks: relevant.length, functionCalls: executed };
    }
    return { reply: FALLBACK_REPLY, escalate: false, reason: "tool loop exhausted", usedChunks: relevant.length, functionCalls: executed };
  } catch (err) {
    console.error("[llm] generate failed:", err);
    // API failure → surface a safe fallback rather than nothing.
    return { reply: FALLBACK_REPLY, escalate: false, reason: "generation error (fallback)", usedChunks: relevant.length };
  }
}

// Rewrites a factual FAQ/cache answer in the agent's persona voice, matching
// the customer's language and the agent's style rules. Facts are preserved;
// any failure (rate limit, etc.) falls back to the raw answer — never blocks.
export async function applyPersonaTone(answer: string, userMessage: string, agentId?: string | null, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<string> {
  try {
    if (!(await isToneEnabled(tenantId))) return answer;
    const agent = await resolveAgent(agentId ?? null, tenantId);
    if (!agent?.persona?.trim()) return answer;

    const ai = await resolveTenantAi(tenantId, agent.model ?? null);
    const system = [
      agent.persona.trim(),
      agent.constraintsText?.trim() ? `--- Constraints ---\n${agent.constraintsText.trim()}` : "",
      "--- Task ---",
      "Rewrite the FACTUAL ANSWER as your WhatsApp reply to the customer's message, fully in your persona and style.",
      "Match the customer's language (Hindi / Hinglish / English).",
      "Keep every fact, number, name, and contact detail exactly — add NOTHING new, remove nothing essential.",
      "Output ONLY the reply text.",
    ].filter(Boolean).join("\n\n");
    const res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system,
      turns: [{ role: "user", text: `CUSTOMER MESSAGE:\n${userMessage}\n\nFACTUAL ANSWER:\n${answer}` }],
      maxTokens: 512,
    });
    return res.text || answer;
  } catch (err) {
    // AiKeyMissingError, rate limits, etc. — never block; serve the raw answer.
    console.error("[llm] persona tone failed (serving raw answer):", err);
    return answer;
  }
}

// One-shot text transform for agent assist (tone change, translate, fix, etc).
// Uses the tenant's own chat provider; throws AiKeyMissingError if unconfigured.
export async function transformText(instruction: string, text: string, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<string> {
  const ai = await resolveTenantAi(tenantId);
  const res = await runChat({
    provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
    system: "You rewrite text exactly as instructed and output only the result.",
    turns: [{ role: "user", text: `${instruction}\n\nReturn ONLY the rewritten text, no preamble.\n\n--- TEXT ---\n${text}` }],
    maxTokens: 1024,
  });
  return res.text;
}
