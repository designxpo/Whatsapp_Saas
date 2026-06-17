import { retrieve } from "./kb";
import { resolveAgent, listFunctions, executeAiFunction, isToneEnabled, type AiFunction } from "./aihub";
import { runChat, type ChatTool, type ChatTurn } from "./ai/chat";
import { resolveTenantAi, AiKeyMissingError } from "./ai/keys";
import { getContactByPhone, setContactAttributes, updateContactProfile } from "./store";

// Below this cosine similarity, retrieved context is treated as irrelevant.
const MIN_SIMILARITY = 0.45;
const ESCALATE_TOKEN = "[[ESCALATE]]";
const MAX_TOOL_ROUNDS = 3;

export const FALLBACK_REPLY =
  "Thanks for your message! A team member will get back to you shortly.";

// Sent when there's nothing grounded to answer with (empty KB, vague greeting).
// Keeps the conversation OPEN — asks for detail and offers the human path —
// instead of instantly handing off. Escalation is reserved for explicit human
// requests / complaints, so a simple "Hi" never triggers a handover.
export const SOFT_FALLBACK =
  "Thanks for reaching out! 🙂 Could you tell me a little more about what you're looking for? I'm happy to help — or just type \"agent\" anytime to reach our team.";

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
function systemPrompt(context: string, agent: { persona: string; constraintsText: string; productInfo: string } | null, hasTools: boolean, profile = "", askPhone = false): string {
  const persona = agent?.persona?.trim() || process.env.BOT_SYSTEM_PROMPT?.trim() || [
    "You are a helpful WhatsApp assistant for a business.",
    "Reply in a warm, concise, professional tone suited to WhatsApp — short paragraphs, no markdown headings.",
  ].join("\n");

  const parts = [persona];
  if (agent?.constraintsText?.trim()) parts.push(`--- Constraints ---\n${agent.constraintsText.trim()}`);
  if (agent?.productInfo?.trim()) parts.push(`--- Product & service information ---\n${agent.productInfo.trim()}`);
  if (profile.trim()) parts.push([
    "--- Who you're talking to (remembered from earlier) ---",
    profile.trim(),
    "Greet returning customers by name and use these details. NEVER ask for information you already have here.",
  ].join("\n"));
  parts.push([
    "--- Grounding rules ---",
    "Answer factual questions ONLY using the Business context below. Do not invent facts, prices, policies, or availability.",
    hasTools
      ? "When you have collected the details a function needs (per its description), CALL the function. You may keep conversing when context is missing — collecting details does not require business context."
      : "",
    `If the user EXPLICITLY asks for a human/agent, or raises a complaint or sensitive issue, reply with exactly ${ESCALATE_TOKEN} and nothing else. Otherwise stay helpful — if you're unsure or missing details, ask one brief clarifying question instead of escalating. Never hand off just because a question is vague or a greeting.`,
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
  if (askPhone) parts.push([
    "--- Capture contact ---",
    "You don't have this person's phone number yet. If they show interest (ask about courses, fees, enrolment, a callback, or details), politely ask once for their WhatsApp number so the team can share details or call back — e.g. \"Could you share your WhatsApp number so our team can send you the details?\" Ask at most once and never pressure them; if they decline, carry on helpfully.",
  ].join("\n"));
  parts.push(`--- Business context ---\n${context || "(no relevant context found)"}`);
  return parts.join("\n\n");
}

// ── Built-in customer memory ────────────────────────────────────────────────
// A tool the model can call whenever the customer reveals who they are, so we
// persist it to the contact and recognise them in any future conversation.
const MEMORY_FN = "remember_customer";
const MEMORY_TOOL: ChatTool = {
  name: MEMORY_FN,
  description: "Save personal details the customer shares — their name, email, city, or what they're interested in — so you remember them next time. Call this AS SOON AS the customer tells you any of these, then continue the conversation normally.",
  params: [
    { name: "name", description: "The customer's name" },
    { name: "email", description: "The customer's email address" },
    { name: "city", description: "The customer's city or location" },
    { name: "interest", description: "What the customer is interested in (course, product, topic)" },
  ],
  required: [],
};

async function rememberCustomer(phone: string, args: Record<string, unknown>, tenantId: string): Promise<void> {
  const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  const name = s(args.name), email = s(args.email), city = s(args.city), interest = s(args.interest);
  if (name || email) await updateContactProfile(phone, { ...(name ? { name } : {}), ...(email ? { email } : {}) }, tenantId).catch(() => undefined);
  const attrs: Record<string, string> = {};
  if (city) attrs.city = city;
  if (interest) attrs.interest = interest;
  if (Object.keys(attrs).length) await setContactAttributes(phone, attrs, tenantId).catch(() => undefined);
}

// Compact "what we already know" block for the system prompt.
function knownProfile(contact: { name?: string | null; email?: string | null; attributes?: Record<string, string> } | null): string {
  if (!contact) return "";
  const lines: string[] = [];
  if (contact.name?.trim()) lines.push(`Name: ${contact.name.trim()}`);
  if (contact.email?.trim()) lines.push(`Email: ${contact.email.trim()}`);
  for (const [k, v] of Object.entries(contact.attributes ?? {})) if (v?.trim()) lines.push(`${k}: ${v.trim()}`);
  return lines.join("\n");
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
export async function generateReply(history: { role: "user" | "assistant"; body: string }[], phone?: string, agentId?: string | null, tenantId = "00000000-0000-0000-0000-000000000001", primaryKbTag?: string | null, askPhone = false): Promise<ReplyResult> {
  const lastUser = [...history].reverse().find(m => m.role === "user");
  if (!lastUser) return { reply: null, escalate: true, reason: "no user message", usedChunks: 0 };

  // Agent persona + function tools (both optional — defaults preserve old behavior).
  const [agent, functions] = await Promise.all([
    resolveAgent(agentId, tenantId).catch(() => null),
    listFunctions(true, tenantId).catch(() => [] as Awaited<ReturnType<typeof listFunctions>>),
  ]);
  // Configured AI functions + a built-in "remember" tool so the model can
  // persist the customer's name/details. `functions` stays the configured list
  // (the no-context guard below keys off it, not the built-in tool).
  const tools: ChatTool[] = [...(toChatTools(functions) ?? []), MEMORY_TOOL];

  // Retrieve business context for the latest question.
  let chunks: { content: string; similarity: number }[] = [];
  try {
    chunks = await retrieve(lastUser.body, 6, tenantId, primaryKbTag);
  } catch (err) {
    console.error("[llm] retrieve failed:", err);
  }
  const relevant = chunks.filter(c => c.similarity >= MIN_SIMILARITY);

  // No relevant knowledge AND no agent/tools to carry the conversation → don't
  // hand off to a human (that frustrated users on greetings); keep the chat open
  // with a soft prompt for more detail.
  if (relevant.length === 0 && !agent && functions.length === 0) {
    return { reply: SOFT_FALLBACK, escalate: false, reason: "no relevant context", usedChunks: 0 };
  }

  // What we already know about this person — injected so the AI recognises
  // returning customers and never re-asks for details already on file.
  const contact = phone ? await getContactByPhone(phone, tenantId).catch(() => null) : null;
  const profile = knownProfile(contact);

  const context = relevant.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");
  const system = systemPrompt(context, agent, tools.length > 0, profile, askPhone);

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
          if (c.name === MEMORY_FN) {
            if (phone) await rememberCustomer(phone, c.args, tenantId);
            executed.push(MEMORY_FN);
            results.push({ id: c.id, name: c.name, status: "saved" });
            continue;
          }
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

      const text = (res.text ?? "").trim();
      // Only an explicit escalate token hands off to a human. An empty model
      // reply must NOT escalate — fall back to a soft prompt instead.
      if (text.includes(ESCALATE_TOKEN)) {
        return { reply: null, escalate: true, reason: "model escalated", usedChunks: relevant.length, functionCalls: executed };
      }
      if (!text) {
        return { reply: SOFT_FALLBACK, escalate: false, reason: "empty model reply", usedChunks: relevant.length, functionCalls: executed };
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

// ── Sales brief ───────────────────────────────────────────────────────────────
// A concise, sales-call-ready summary of one lead, generated from their chat
// history + collected details. Returns structured fields the UI renders as a card.
// Uses the tenant's own chat provider; throws AiKeyMissingError if unconfigured.
export interface SalesBrief {
  temperature: "hot" | "warm" | "cold";
  summary: string;
  interestedIn: string;
  intent: string;
  objections: string;
  nextStep: string;
  talkingPoints: string[];
}

export async function generateSalesBrief(context: string, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<SalesBrief> {
  const ai = await resolveTenantAi(tenantId);
  const instruction =
    `Read the lead context below (their chat, collected details, campaigns received, and links tapped) and ` +
    `produce a tight brief a salesperson can glance at right before calling this lead.\n\n` +
    `Rules:\n` +
    `- Be specific and grounded ONLY in the context. Never invent facts. If something is unknown, say "Unknown".\n` +
    `- "temperature": "hot" if they showed buying intent (asked price/EMI/enrolment, booked, repeated interest), ` +
    `"warm" if engaged but exploring, "cold" if barely engaged.\n` +
    `- "summary": 1-2 sentences on who they are and where they are in the journey.\n` +
    `- "interestedIn": the specific product/course/offer they care about (or "Unknown").\n` +
    `- "intent": what they're trying to do / their key questions.\n` +
    `- "objections": hesitations or blockers they voiced (or "None surfaced").\n` +
    `- "nextStep": the single best next action for the sales rep.\n` +
    `- "talkingPoints": 2-4 short bullet phrases to open or steer the call.\n` +
    `Return ONLY JSON: {"temperature","summary","interestedIn","intent","objections","nextStep","talkingPoints":[]}.`;

  const res = await runChat({
    provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
    system: "You are a sales-enablement assistant. You output ONLY valid JSON — no markdown fences, no preamble.",
    turns: [{ role: "user", text: `${instruction}\n\n--- LEAD CONTEXT ---\n${context}` }],
    maxTokens: 1024,
  });

  const raw = (res.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  let parsed: Partial<SalesBrief> = {};
  try { parsed = JSON.parse(raw) as Partial<SalesBrief>; } catch { /* fall through to defaults */ }
  const temp = parsed.temperature === "hot" || parsed.temperature === "cold" ? parsed.temperature : "warm";
  return {
    temperature: temp,
    summary: (parsed.summary ?? "").toString().trim() || "Not enough conversation yet to summarise this lead.",
    interestedIn: (parsed.interestedIn ?? "").toString().trim() || "Unknown",
    intent: (parsed.intent ?? "").toString().trim() || "Unknown",
    objections: (parsed.objections ?? "").toString().trim() || "None surfaced",
    nextStep: (parsed.nextStep ?? "").toString().trim() || "Reach out and qualify their interest.",
    talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints.map(t => String(t).trim()).filter(Boolean).slice(0, 4) : [],
  };
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
