import { retrieve } from "./kb";
import { resolveAgent, listFunctions, executeAiFunction, isToneEnabled, type AiFunction } from "./aihub";
import { runChat, providerSupportsMedia, type ChatTool, type ChatTurn, type ChatMedia } from "./ai/chat";
import { resolveTenantAi, AiKeyMissingError } from "./ai/keys";
import { downloadRemoteMedia, visionInlineMime } from "./voice";
import { getContactByPhone, setContactAttributes, updateContactProfile } from "./store";
import { readBehavior, behaviorBlock } from "./behavior";

// Below this cosine similarity, retrieved context is treated as irrelevant.
const MIN_SIMILARITY = 0.45;
const ESCALATE_TOKEN = "[[ESCALATE]]";
// A genuine human-handoff / complaint signal. The model occasionally emits the
// escalate token on a benign one-word menu tap ("Fees", "Courses"), which would
// silence the bot for the whole chat. We only honour an escalation when the
// user's own words actually read like a handoff or complaint.
const HANDOFF_RE = /\b(agent|human|representative|executive|supervisor|manager|complaint|refund|cancel(led|lation)?|angry|frustrat|useless|terrible|worst|rubbish|scam|fraud|lawyer|legal|call\s*me|call\s*back|talk to|speak to|connect me|real person|customer care)\b/i;
const MAX_TOOL_ROUNDS = 3;

export const FALLBACK_REPLY =
  "Thanks for your message! A team member will get back to you shortly.";

// Sent when there's nothing grounded to answer with (empty KB, vague greeting).
// Keeps the conversation OPEN — asks for detail and offers the human path —
// instead of instantly handing off. Escalation is reserved for explicit human
// requests / complaints, so a simple "Hi" never triggers a handover.
export const SOFT_FALLBACK =
  "Thanks for reaching out! 🙂 Could you tell me a little more about what you're looking for? I'm happy to help — or just type \"agent\" anytime to reach our team.";

// Sent when a low-stakes / ambiguous one-off ("??", "ok", "huh") produced no
// usable answer (empty model reply or a transient API error). A warm nudge for
// detail is far better than a false "a team member will get back to you" promise.
export const CLARIFY_REPLY =
  "Sorry, I didn't quite get that 🙂 Could you tell me a bit more about what you're looking for?";

// A greeting / opener must ALWAYS get a warm hello — never "I didn't get that".
// The prompt makes the model greet normally; this is the safety net for when the
// model returns nothing or errors on a greeting, so a bare "hi" can never fall
// through to CLARIFY_REPLY.
export const GREETING_REPLY =
  "Hi there! 👋 Welcome — how can I help you today? 😊";
const GREETING_RE = /^\s*(?:hi+|hey+|hello+|helo+|hiya|yo+|hola|namaste|namaskar|salaam|good\s*(?:morning|afternoon|evening|day)|gm|greetings)[\s!.,]*$/i;
function isGreeting(text: string): boolean {
  return GREETING_RE.test((text || "").trim());
}
// Punctuation-only / filler / single tiny token — nudge for clarity, don't hand off.
const AMBIGUOUS_RE = /^(?:[?.!]+|h+u+h+|hm+|hu+|o+k+(?:ay)?|k+|ya+|yo+|he+y+|hi+|hello+|wat|wut|what\??)$/i;
function isLowStakes(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (AMBIGUOUS_RE.test(t)) return true;
  // A very short message with NO real word (3+ letters) — pure filler like "k",
  // "yo", "..". A short but substantive token ("price?", "demo", "ROI?") is NOT
  // low-stakes: on a model hiccup it deserves the team-handoff, not a nudge.
  return t.length <= 6 && !/[A-Za-z]{3,}/.test(t) && !HANDOFF_RE.test(t);
}

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
function systemPrompt(context: string, agent: { persona: string; constraintsText: string; productInfo: string } | null, hasTools: boolean, profile = "", askPhone = false, haveNumber = false, behavior = ""): string {
  const persona = agent?.persona?.trim() || process.env.BOT_SYSTEM_PROMPT?.trim() || [
    "You are a helpful WhatsApp assistant for a business.",
    "Reply in a warm, concise, professional tone suited to WhatsApp — short paragraphs, no markdown headings.",
  ].join("\n");

  const parts = [persona];
  // Whether the knowledge base actually returned anything for this question.
  // Drives the grounding rules: with content we share specifics; with none we
  // must not fabricate (e.g. the KB was deleted → share nothing we can't ground).
  const hasContext = !!context.trim();
  if (agent?.constraintsText?.trim()) parts.push(`--- Constraints ---\n${agent.constraintsText.trim()}`);
  if (agent?.productInfo?.trim()) parts.push(`--- Product & service information ---\n${agent.productInfo.trim()}`);
  if (profile.trim()) parts.push([
    "--- Who you're talking to (remembered from earlier) ---",
    profile.trim(),
    "Greet returning customers by name and use these details. NEVER ask for information you already have here.",
  ].join("\n"));
  parts.push([
    "--- How to answer (general knowledge vs our facts) ---",
    "Be a warm, natural, genuinely helpful assistant — like a knowledgeable human teammate, never robotic. ALWAYS engage with what the customer actually said. Never reply with a bare 'I didn't understand' or 'tell me more' when you can give a real response.",
    "Decide what KIND of message this is and answer accordingly:",
    "• GREETINGS & small talk ('hi', 'hello', 'hey', 'how are you', 'thanks', 'ok'): reply warmly and naturally, say who we are in one short line, and ask how you can help. Never treat a greeting as something you 'didn't get'.",
    "• GENERAL or educational questions about the field (e.g. 'what is data science?', 'is analytics a good career?', 'difference between AI and ML', study/career advice): answer helpfully from your OWN general knowledge — concise and friendly — then gently relate it to how we can help. You do NOT need business context for these.",
    "• BRAND-SPECIFIC facts about THIS business — our courses, fees/prices, dates, batch timings, duration, syllabus, placements, certifications, policies, offers, contact details: answer ONLY from the Business context below. Never invent, guess, or fall back on general knowledge for these specifics.",
    hasContext
      ? "The Business context below HAS relevant info — quote the actual specifics (numbers, names, dates) directly and confidently. Don't deflect to a counselor or say you'll 'get back'; offer a counselor only as a helpful extra."
      : "No Business context was found for this question. Do NOT state, guess, or imply any specific course, fee, date, or policy about us. Still answer any GENERAL part of the message naturally, and for the brand-specific part ask which course/detail they mean or offer to connect the team — warmly, never a canned non-answer.",
    hasTools
      ? "When you have collected the details a function needs (per its description), CALL the function. You may keep conversing when context is missing — collecting details does not require business context."
      : "",
    `If the user EXPLICITLY asks for a human/agent, or raises a complaint or sensitive issue, reply with exactly ${ESCALATE_TOKEN} and nothing else. Never escalate, go silent, or stall just because a message is short, a greeting, or vague — handle those yourself.`,
    "Never promise anything our context doesn't support. No medical, legal, or financial advice.",
  ].filter(Boolean).join("\n"));
  // Behaviour read (sentiment / journey stage / urgency) — adapts tone + next step.
  if (behavior.trim()) parts.push(behavior.trim());
  parts.push([
    "--- WhatsApp formatting (always) ---",
    "• LANGUAGE — decide per message from the customer's LATEST message only, never from the conversation as a whole. DEFAULT to English: open in English, and reply in English whenever the latest message is in English OR its language is unclear (a greeting, 'ok'/'yes'/'thanks', a single word, emojis, or just numbers). Use Hindi (Devanagari), Hinglish, or another language ONLY when the customer's LATEST message is clearly written in it. If the customer SWITCHES — e.g. earlier messages were Hinglish but their latest one is in English — switch with them immediately and reply in English; likewise switch to Hinglish only when their latest message is Hinglish. Never go quiet or refuse just because a message isn't in English. If the Business context is in English, translate the relevant facts into the customer's language.",
    "• When the customer writes Hinglish (Hindi in Latin script), reply in clean Hinglish using LATIN SCRIPT ONLY — never mix Devanagari and Latin in one message. Keep every reply polished, natural and professional — never clumsy, literal, or word-for-word translated.",
    "• Keep replies under ~120 words, in short 1–2 line paragraphs.",
    "• When listing 2+ items (courses, steps, options), put each on its own line starting with the • character. Use *asterisks* to bold key terms like course names or prices.",
    "• When the Business context contains a relevant URL (course page, brochure, contact), include it as a bare link on its own line — never markdown [text](url).",
    "• Never prefix replies with your name, role, or labels (no 'SUPPORT:', no 'Maya:'). Just speak naturally.",
    "• NEVER introduce yourself by a personal name and never say 'I am <name>' / 'I'm <name>' / 'My name is <name>' / 'This is <name>'. You have NO personal name. If the persona above contains a name, IGNORE that name entirely. If asked who you are, say only that you're the business's AI assistant (you may use the business name from your context) — never a human first name.",
    "• End with one short, helpful follow-up question when it moves the conversation forward.",
  ].join("\n"));
  if (askPhone) parts.push([
    "--- Capture contact ---",
    "You don't have this person's phone number yet. If they show interest (ask about courses, fees, enrolment, a callback, or details), politely ask once for their WhatsApp number so the team can share details or call back — e.g. \"Could you share your WhatsApp number so our team can send you the details?\" Ask at most once and never pressure them; if they decline, carry on helpfully.",
  ].join("\n"));
  else if (haveNumber) parts.push([
    "--- Contact (already known) ---",
    "This is a WhatsApp chat, so you ALREADY have this person's phone number — it is the number they are messaging from. NEVER ask them for their phone, mobile, or WhatsApp number, and never ask them to \"share their number\" for a callback or to receive details — the team can already reach them right here. Early in the conversation, if you don't already know them (check the remembered-profile block above), warmly ask ONCE for their name and city in a single short, friendly question — but NEVER block or delay answering their actual question to get it. As soon as they share their name or city, call remember_customer to save it.",
  ].join("\n"));
  parts.push([
    "--- Course / program consistency ---",
    "If the customer has chosen or named a specific course/program (it may be in their remembered profile above or earlier in this chat), answer ONLY about THAT course. NEVER quote a different course's fees, duration, dates, or details. If you are not sure which course they mean, ask them to confirm before giving specifics — do not guess.",
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
  description: "Save personal details the customer reveals ABOUT THEMSELVES — their own name, email, city, or interest — so you remember them next time. Call this as soon as the customer shares any of these, then continue normally. Do NOT call it for a name the customer uses to greet or address you or someone else.",
  params: [
    { name: "name", description: "The customer's OWN name — only when they state it about themselves (e.g. \"I'm Riya\", \"my name is Riya\", \"this is Rohan\"). NEVER pass a name they use to greet or address you or someone else (e.g. \"Hey Maya\", \"Hi Digvijay\", \"thanks sir\") — that is not the customer's name. If unsure whether a name refers to the customer, leave it out." },
    { name: "email", description: "The customer's email address" },
    { name: "city", description: "The customer's city or location" },
    { name: "interest", description: "What the customer is interested in (course, product, topic)" },
  ],
  required: [],
};

// "Hey Digvijay!", "Hi Maya", "thanks sir Rohan" — a name the customer uses to
// GREET or ADDRESS someone is not their own name. The model occasionally misreads
// these as a self-introduction, so we drop a captured name the latest message is
// clearly addressing rather than stating.
export function nameIsAddressed(text: string, name: string): boolean {
  const n = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!n) return false;
  return new RegExp(`\\b(?:hey|hi+|hello+|helo|namaste|yo|dear|sir|maam|ma'?am|thanks?|thank\\s+you)\\s*[,!]?\\s+${n}\\b`, "i").test(text);
}

async function rememberCustomer(phone: string, args: Record<string, unknown>, tenantId: string, ctx: { lastUserText?: string; agentName?: string | null; existingName?: string | null } = {}): Promise<void> {
  const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  let name = s(args.name);
  const email = s(args.email), city = s(args.city), interest = s(args.interest);

  // Guard against the classic mis-capture: the customer addressing the assistant
  // ("Hey Digvijay!") saved as the customer's name. Drop a name that equals the
  // assistant's/counselor's own name, or that the latest message is addressing.
  if (name) {
    const agentName = (ctx.agentName ?? "").trim().toLowerCase();
    if (agentName && name.toLowerCase() === agentName) name = "";
    else if (ctx.lastUserText && nameIsAddressed(ctx.lastUserText, name)) name = "";
  }
  // Never let an AI guess REPLACE a name already on file (the WhatsApp profile
  // name the customer set themselves, or one an agent entered) — only fill a
  // missing one. The manual "edit" path is separate and still overwrites freely.
  if (name && (ctx.existingName ?? "").trim()) name = "";

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

// Strip a leading persona/name label the model sometimes prepends despite the
// system prompt — e.g. "Maya:", "*Maya*:", "MAYA SUPPORT:", "MAYA CUSTOMER
// SUPPORT:", "**MAYA SUPPORT:**", "SUPPORT:". Two passes:
//   1) a ROLE label — any (0–2 word) name followed by a role word (support/
//      sales/team…), any case, colon optionally bold-wrapped and no whitespace
//      required after it ("MAYA SUPPORT:The…"). This is what leaked in production:
//      "**MAYA SUPPORT:**" slipped past the old name-only regex because the bold
//      "**" sat between the colon and the space.
//   2) a 1–2 TitleCase-word personal name, kept when it's a common content opener
//      ("Note:", "Fees:", "Total:", "Contact:") so real content survives.
const ROLE_WORDS = "(?:support|sales|service|team|helpdesk|care|assistant|bot|agent|concierge|advisor|counsell?or)";
const ROLE_PREFIX_RE = new RegExp(
  "^\\s*\\*{0,2}\\s*(?:[A-Za-z][\\w.'’-]*\\s+){0,2}" + ROLE_WORDS + "(?:\\s+" + ROLE_WORDS + ")*\\s*\\*{0,2}\\s*:\\*{0,2}\\s*",
  "i",
);
const NAME_PREFIX_RE = /^\s*\*{0,2}\s*([A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+)?)\s*\*{0,2}\s*:\*{0,2}\s+/;
const COMMON_LABELS = new Set([
  "note", "tip", "tips", "hours", "fee", "fees", "price", "prices", "update", "reminder",
  "hi", "hello", "hey", "warning", "important", "fyi", "ps", "re", "attention", "menu",
  "options", "welcome", "thanks", "thank", "sure", "okay", "ok", "yes", "no", "namaste",
  // Common "Label: value" content openers — keep these intact.
  "total", "subtotal", "duration", "module", "level", "day", "week", "step", "date", "time",
  "contact", "info", "email", "phone", "address", "website", "location", "venue", "amount", "discount",
]);
// Remove a MID-sentence self-introduction by personal name — "I'm Asha, an
// admissions assistant", "I am Asha.", "My name is Asha", "this is Asha",
// "Asha here", "— Asha". The assistant has NO personal name, but a persona that
// names itself slips past the system prompt, so we strip the KNOWN agent name out
// of any self-intro after the fact. We target the configured name only (never any
// capitalised word), so real content like "I'm happy to help" is never touched.
function scrubSelfIntro(text: string, agentName?: string | null): string {
  const name = (agentName ?? "").trim();
  if (!name || !text) return text;
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text;
  out = out.replace(new RegExp(`\\b(I'?m|I am)\\s+${n}\\s*,\\s*`, "gi"), "$1 ");                 // "I'm Asha, an advisor" → "I'm an advisor"
  out = out.replace(new RegExp(`\\b(?:my name is|this is|I'?m|I am)\\s+${n}\\b\\.?`, "gi"), ""); // "My name is Asha." → ""
  out = out.replace(new RegExp(`\\b${n}\\s+here\\b\\.?,?`, "gi"), "");                           // "Asha here," → ""
  out = out.replace(new RegExp(`[—–-]\\s*${n}\\s*$`, "i"), "");                                  // "— Asha" sign-off
  if (out === text) return text;                          // nothing scrubbed → leave spacing untouched
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

export function stripLeadingName(text: string, agentName?: string | null): string {
  // Pass 1 — role/persona label, regardless of agent name or case.
  const r = text.match(ROLE_PREFIX_RE);
  if (r) {
    const out = text.slice(r[0].length).trimStart();
    if (out) return scrubSelfIntro(out, agentName);   // never strip away the whole message
  }
  // Pass 2 — a 1–2 word personal-name label.
  const m = text.match(NAME_PREFIX_RE);
  if (!m) return scrubSelfIntro(text, agentName);
  const label = m[1].trim();
  const first = label.split(/\s+/)[0].toLowerCase();
  const matchesAgent = !!agentName && label.toLowerCase() === agentName.trim().toLowerCase();
  if (!matchesAgent && COMMON_LABELS.has(first)) return scrubSelfIntro(text, agentName);
  const out = text.slice(m[0].length).trimStart();
  return scrubSelfIntro(out || text, agentName);
}

// Build the text we EMBED for RAG retrieval. A message is anaphoric/elliptical —
// it leans on the prior turn for its subject — when it OPENS with a back-reference
// ("and the duration?", "what about placements", "tell me more", "that one") or is
// a BARE aspect word with no subject of its own ("fees?", "duration",
// "placements?"). We fuse ONLY these with the single prior user turn. A
// self-contained question — even a short one like "Python course fees?" — carries
// its own subject and must retrieve on its own terms, so we must NOT fuse it (that
// would drift it toward the prior topic).
const FOLLOWUP_OPENER = /^(?:and|also|but|what about|how about|what if|tell me more|tell me|more|elaborate|go on|continue|that one|that|this|it|they|them|those|same|again|ok(?:ay)?|yes|yeah|yep|sure|cool)\b/i;
const BARE_ASPECT = /^(?:cost|costs|price|pricing|fees?|fee structure|duration|timing|timings|placements?|syllabus|curriculum|eligibility|scope|salary|certificate|certification|emi|discount|scholarship|details?|info|more info)\s*\??$/i;

export function retrievalQuery(history: { role: "user" | "assistant"; body: string }[]): string {
  const userTurns = history.filter(m => m.role === "user" && m.body?.trim());
  const last = userTurns[userTurns.length - 1]?.body.trim() ?? "";
  if (!last) return "";
  if (!FOLLOWUP_OPENER.test(last) && !BARE_ASPECT.test(last)) return last;   // self-contained → on its own terms
  const prev = userTurns[userTurns.length - 2]?.body.trim();
  return prev ? `${prev} ${last}`.slice(0, 400) : last;
}

// Generates a grounded reply from conversation history. `history` must end with
// the user's latest message. `phone` enables function-calling attribute capture.
// `agentId` pins a specific agent (conversation routing); null → active agent.
export async function generateReply(history: { role: "user" | "assistant"; body: string; mediaUrl?: string | null; mediaType?: string | null }[], phone?: string, agentId?: string | null, tenantId = "00000000-0000-0000-0000-000000000001", primaryKbTag?: string | null, askPhone = false): Promise<ReplyResult> {
  const lastUser = [...history].reverse().find(m => m.role === "user");
  if (!lastUser) return { reply: null, escalate: true, reason: "no user message", usedChunks: 0 };

  // ── Inbound media (image / PDF / short video) → let the model SEE it. ──
  // Find the newest customer turns carrying a file a vision model can look at.
  // Cheap (no network yet) so it can gate the no-context fallback below; bytes
  // are fetched later, only once we know we're calling the model.
  const MEDIA_MAX = 4, MEDIA_BUDGET = 16 * 1024 * 1024;
  const mediaTurns: { idx: number; mime: string; url: string }[] = [];
  for (let i = history.length - 1; i >= 0 && mediaTurns.length < MEDIA_MAX; i--) {
    if (history[i].role !== "user" || !history[i].mediaUrl) continue;
    const mime = visionInlineMime(history[i].mediaType);
    if (mime) mediaTurns.push({ idx: i, mime, url: history[i].mediaUrl! });
  }
  const hasVisionMedia = mediaTurns.length > 0;

  // Agent persona + function tools (both optional — defaults preserve old behavior).
  const [agent, functions] = await Promise.all([
    resolveAgent(agentId, tenantId).catch(() => null),
    listFunctions(true, tenantId).catch(() => [] as Awaited<ReturnType<typeof listFunctions>>),
  ]);
  // Configured AI functions + a built-in "remember" tool so the model can
  // persist the customer's name/details. `functions` stays the configured list
  // (the no-context guard below keys off it, not the built-in tool).
  const tools: ChatTool[] = [...(toChatTools(functions) ?? []), MEMORY_TOOL];

  // Retrieve business context for the latest question. k=8 gives the model enough
  // material to synthesise an answer that spans several documents (fees in one,
  // schedule in another) rather than a thin single-chunk summary.
  let chunks: { content: string; similarity: number }[] = [];
  try {
    chunks = await retrieve(retrievalQuery(history), 8, tenantId, primaryKbTag);
  } catch (err) {
    console.error("[llm] retrieve failed:", err);
  }
  const relevant = chunks.filter(c => c.similarity >= MIN_SIMILARITY);

  // NOTE: we deliberately do NOT short-circuit to a canned reply when there's no
  // KB context / no agent. The grounding rules let the model greet, make small
  // talk, and answer GENERAL questions from its own knowledge while refusing to
  // invent brand-specific facts — so a plain "hi" gets a natural reply instead of
  // the old "I didn't get that". The model is always given the chance to respond.

  // What we already know about this person — injected so the AI recognises
  // returning customers and never re-asks for details already on file.
  const contact = phone ? await getContactByPhone(phone, tenantId).catch(() => null) : null;
  const profile = knownProfile(contact);

  const context = relevant.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");
  // Zero-cost behaviour read → adapts tone + next step (educate / convert / de-escalate).
  const behavior = behaviorBlock(readBehavior(history));
  const system = systemPrompt(context, agent, tools.length > 0, profile, askPhone, !!phone && !askPhone, behavior);

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

  // Pull inline bytes for the media turns THIS provider can see (parallel, budget-
  // capped), re-hosted URL → base64. A failed / oversized / unsupported file is
  // just dropped — the turn keeps its text, so a heavy attachment never breaks the
  // chat. (Provider capabilities differ: images everywhere, PDFs on Gemini +
  // Anthropic, video on Gemini only.)
  const inlineByIdx = new Map<number, ChatMedia[]>();
  if (hasVisionMedia) {
    const supported = mediaTurns.filter(t => providerSupportsMedia(ai.provider, t.mime));
    const dls = await Promise.all(supported.map(async t => {
      const dl = await downloadRemoteMedia(t.url).catch(() => null);
      return dl ? { idx: t.idx, mime: t.mime, data: dl.data } : null;
    }));
    let used = 0;
    for (const f of dls) {
      if (!f || used + f.data.length > MEDIA_BUDGET) continue;
      used += f.data.length;
      const arr = inlineByIdx.get(f.idx) ?? [];
      arr.push({ mimeType: f.mime, data: f.data.toString("base64") });
      inlineByIdx.set(f.idx, arr);
    }
  }
  const sawMedia = inlineByIdx.size > 0;

  const turns: ChatTurn[] = history.map((m, i): ChatTurn => {
    if (m.role === "assistant") return { role: "assistant", text: m.body };
    const media = inlineByIdx.get(i);
    // A media-only turn carries a "[image message]" placeholder. Once the model
    // can see the file, swap it for a clear instruction; otherwise keep the text.
    const placeholder = /^\[(image|video|document|sticker) message\]$/.test(m.body.trim());
    const text = media && placeholder ? "(The customer sent the attached file with no caption — look at it and respond.)" : m.body;
    return media ? { role: "user", text, media } : { role: "user", text: m.body };
  });

  const systemWithMedia = sawMedia
    ? system + "\n\nThe customer has attached one or more files (image, PDF, or video). Examine the attached file(s) and answer about what you actually see in them. Never say you cannot open, view, or access files."
    : system;

  try {
    let escalateViaFn = false;
    const executed: string[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await runChat({ provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system: systemWithMedia, turns, tools, maxTokens: 1024, timeoutMs: sawMedia ? 60000 : undefined });

      // Function-calling round: execute each call, feed results back, continue.
      if (res.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
        turns.push({ role: "assistant", calls: res.toolCalls });
        const results = [];
        for (const c of res.toolCalls) {
          if (c.name === MEMORY_FN) {
            if (phone) await rememberCustomer(phone, c.args, tenantId, { lastUserText: lastUser.body, agentName: agent?.name, existingName: contact?.name });
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

      const text = stripLeadingName((res.text ?? "").trim(), agent?.name);
      // Only an explicit escalate token hands off to a human. An empty model
      // reply must NOT escalate — fall back to a soft prompt instead.
      if (text.includes(ESCALATE_TOKEN)) {
        // Guard against false-positive handoffs: a mis-escalation turns the bot
        // OFF for the whole conversation (status → escalated). If the user's last
        // message is short and shows no handoff/complaint intent (e.g. a menu tap
        // like "Fees"), keep the bot active with a soft prompt instead.
        const msg = lastUser.body.trim();
        const benign = msg.split(/\s+/).length <= 3 && !HANDOFF_RE.test(msg);
        if (benign) {
          return { reply: SOFT_FALLBACK, escalate: false, reason: "escalate suppressed (benign message)", usedChunks: relevant.length, functionCalls: executed };
        }
        return { reply: null, escalate: true, reason: "model escalated", usedChunks: relevant.length, functionCalls: executed };
      }
      if (!text) {
        // A greeting always gets a warm hello; a trivial/ambiguous one-off ("??")
        // gets a clarifying nudge; otherwise a soft prompt — never a non-answer.
        const reply = isGreeting(lastUser.body) ? GREETING_REPLY : isLowStakes(lastUser.body) ? CLARIFY_REPLY : SOFT_FALLBACK;
        return { reply, escalate: false, reason: "empty model reply", usedChunks: relevant.length, functionCalls: executed };
      }
      return { reply: text, escalate: escalateViaFn, reason: escalateViaFn ? "function handoff" : undefined, usedChunks: relevant.length, functionCalls: executed };
    }
    const exhausted = isGreeting(lastUser.body) ? GREETING_REPLY : isLowStakes(lastUser.body) ? CLARIFY_REPLY : FALLBACK_REPLY;
    return { reply: exhausted, escalate: false, reason: "tool loop exhausted", usedChunks: relevant.length, functionCalls: executed };
  } catch (err) {
    console.error("[llm] generate failed:", err);
    // API failure → a warm hello for a greeting, a clarifying nudge for low-stakes
    // input, otherwise the safe team-handoff fallback. Never "I didn't get that"
    // for a "hi".
    const reply = isGreeting(lastUser.body) ? GREETING_REPLY : isLowStakes(lastUser.body) ? CLARIFY_REPLY : FALLBACK_REPLY;
    return { reply, escalate: false, reason: "generation error (fallback)", usedChunks: relevant.length };
  }
}

// Lightweight validator for flow `ask` nodes set to validate a city/place. Uses
// the tenant's chat provider for a yes/no classification. Best-effort: on any
// error (missing key, rate limit) it returns true (accept) so a hiccup never
// traps a customer mid-flow.
export async function looksLikeCity(text: string, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<boolean> {
  const t = (text || "").trim();
  if (t.length < 2 || t.length > 60) return false;
  try {
    const ai = await resolveTenantAi(tenantId);
    const res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
      system: 'Answer with only "yes" or "no".',
      turns: [{ role: "user", text: `Is "${t}" a real city, town, or place name (anywhere in the world)?` }],
      maxTokens: 5,
    });
    return /\byes\b/i.test((res.text ?? "").trim());
  } catch {
    return true;
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
      "IMPORTANT: never introduce yourself by a personal name or say 'I am <name>' / 'I'm <name>'. You have no personal name — you are the business's AI assistant. If the persona contains a name, ignore it.",
      "--- Task ---",
      "Rewrite the FACTUAL ANSWER as your WhatsApp reply to the customer's message, fully in your persona and style.",
      "Reply in the language of the customer's LATEST message, decided per message — DEFAULT to English, and switch back to English the moment their latest message is in English (even if earlier ones were Hinglish). Use Hindi/Hinglish only when their latest message clearly is. For Hinglish use Latin script ONLY — never mix Devanagari and Latin in one message. Keep it polished and professional.",
      "Keep every fact, number, name, and contact detail exactly — add NOTHING new, remove nothing essential.",
      "Output ONLY the reply text.",
    ].filter(Boolean).join("\n\n");
    const res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system,
      turns: [{ role: "user", text: `CUSTOMER MESSAGE:\n${userMessage}\n\nFACTUAL ANSWER:\n${answer}` }],
      maxTokens: 512,
    });
    return stripLeadingName(res.text || answer, agent.name);
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

// ── Executive brief ───────────────────────────────────────────────────────────
// A CEO-level read of the whole platform from its metrics (this week vs last).
// Uses the tenant's own chat provider; throws AiKeyMissingError if unconfigured.
export interface ExecutiveBrief {
  health: "strong" | "steady" | "at-risk";
  headline: string;
  working: string[];
  lacking: string[];
  steps: { action: string; why: string }[];
}

export async function generateExecutiveBrief(context: string, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<ExecutiveBrief> {
  const ai = await resolveTenantAi(tenantId);
  const instruction =
    `You are a sharp growth/operations advisor briefing the CEO of a business that runs customer messaging on ` +
    `WhatsApp + Instagram (broadcasts, chatbot flows, drip sequences, an AI assistant, and a CRM). Read the ` +
    `metrics below (this week vs last week + current totals) and give a holistic, decision-ready brief.\n\n` +
    `Rules:\n` +
    `- Be specific and grounded ONLY in the numbers given. Cite the actual figures/percentages.\n` +
    `- "health": "strong" (growing + healthy rates), "steady" (flat/ok), or "at-risk" (declining volume, poor ` +
    `delivery/read, rising opt-outs/failures/escalations, or a backlog awaiting reply).\n` +
    `- "headline": one punchy sentence summarising the state of the business this week.\n` +
    `- "working": 2-4 concrete bright spots (with numbers).\n` +
    `- "lacking": 2-4 weak/declining areas needing attention (with numbers).\n` +
    `- "steps": 2-5 prioritised {action, why} — action = a specific thing to do in THIS platform, why ties to a ` +
    `metric. Order by impact.\n` +
    `Return ONLY JSON: {"health","headline","working":[],"lacking":[],"steps":[{"action","why"}]}.`;

  const res = await runChat({
    provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
    system: "You are an analytics advisor. You output ONLY valid JSON — no markdown fences, no preamble.",
    turns: [{ role: "user", text: `${instruction}\n\n--- METRICS ---\n${context}` }],
    maxTokens: 1536,
  });

  const raw = (res.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  let p: Partial<ExecutiveBrief> = {};
  try { p = JSON.parse(raw) as Partial<ExecutiveBrief>; } catch { /* defaults below */ }
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []);
  return {
    health: p.health === "strong" || p.health === "at-risk" ? p.health : "steady",
    headline: (p.headline ?? "").toString().trim() || "Not enough data yet to assess this week.",
    working: arr(p.working).slice(0, 4),
    lacking: arr(p.lacking).slice(0, 4),
    steps: Array.isArray(p.steps) ? p.steps.map(s => ({ action: String(s?.action ?? "").trim(), why: String(s?.why ?? "").trim() })).filter(s => s.action).slice(0, 5) : [],
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
