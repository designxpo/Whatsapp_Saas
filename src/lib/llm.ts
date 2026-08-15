import { retrieve } from "./kb";
import { resolveAgent, listFunctions, executeAiFunction, isToneEnabled, type AiFunction } from "./aihub";
import { runChat, providerSupportsMedia, type ChatTool, type ChatTurn, type ChatMedia } from "./ai/chat";
import { resolveTenantAi, AiKeyMissingError } from "./ai/keys";
import { downloadRemoteMedia, visionInlineMime } from "./voice";
import { getContactByPhone, setContactAttributes, updateContactProfile, setConversationName } from "./store";
import { readBehavior, behaviorBlock } from "./behavior";
import { syncLeadProfile } from "./leadsquared";
import { listProducts, getOpenCart, upsertCart, checkoutCart, findProductByQuery } from "./commerce";
import { sanitizeOutbound, PUBLIC_CONTACT_EMAIL, type GroundingAction } from "./guard/sanitize";
import { moderateText } from "./moderation";
// Persona/email scrubbers now live in the shared guard module; re-exported so
// existing importers (and tests) keep resolving them from "@/lib/llm".
export { stripLeadingName, scrubContactEmails } from "./guard/sanitize";

// Below this cosine similarity, retrieved context is treated as irrelevant.
const MIN_SIMILARITY = 0.45;
// Above this, a single chunk is strong enough to quote specifics from confidently.
const SOLID_SIMILARITY = 0.62;

// How well the KB covers the question — graduated, not binary. A lone marginal
// chunk ('thin') is the upstream cause of fabricated specifics: the model treats
// any non-empty context as license to assert. The band lets the prompt demand
// deferral on thin evidence while staying confident on solid evidence.
export type CoverageBand = "none" | "thin" | "solid";
function coverageBand(sims: number[]): CoverageBand {
  if (!sims.length) return "none";
  const top = Math.max(...sims);
  const strong = sims.filter(s => s >= 0.55).length;
  return top >= SOLID_SIMILARITY || strong >= 2 ? "solid" : "thin";
}

// The business's approved contact details — the firewall's allow-set floor. In
// the multi-tenant SaaS these are empty by default (per-tenant config supplies
// them); an unset value simply means "nothing extra is pre-approved".
const APPROVED_PHONES = (process.env.PUBLIC_CONTACT_PHONE || "").split(",").map(s => s.trim()).filter(Boolean);
const ESCALATE_TOKEN = "[[ESCALATE]]";
// A genuine human-handoff / complaint signal. The model occasionally emits the
// escalate token on a benign one-word menu tap ("Pricing", "Products"), which would
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
function systemPrompt(context: string, agent: { persona: string; constraintsText: string; productInfo: string } | null, hasTools: boolean, profile = "", askPhone = false, haveNumber = false, behavior = "", coverage: CoverageBand = "none", hasCommerce = false): string {
  const persona = agent?.persona?.trim() || process.env.BOT_SYSTEM_PROMPT?.trim() || [
    "You are a helpful WhatsApp assistant for a business.",
    "Reply in a warm, concise, professional tone suited to WhatsApp — short paragraphs, no markdown headings.",
  ].join("\n");

  const parts = [persona];
  // How strongly the knowledge base actually covers this question. Drives the
  // grounding rules: 'solid' → quote specifics confidently; 'thin' → a single
  // marginal chunk, so answer the general part but DEFER brand specifics rather
  // than over-asserting from weak evidence; 'none' → share nothing we can't ground.
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
    "• GENERAL questions about the broader topic/industry this business operates in (e.g. how something in the category generally works, general advice, comparisons not tied to this specific brand): answer helpfully from your OWN general knowledge — concise and friendly — then gently relate it to how we can help. You do NOT need business context for these.",
    "• BRAND-SPECIFIC facts about THIS business — our products/services, prices, dates, availability/timing, duration, specifications, certifications, policies, offers, contact details: answer ONLY from the Business context below. Never invent, guess, or fall back on general knowledge for these specifics.",
    "• CONTACT DETAILS — share a phone number, email, or link ONLY if it appears verbatim in the Business context. NEVER invent or guess one, and never make up a department/staff address such as sales@, info@, or support@. If the context has no contact detail for what they ask, offer to connect them with our team rather than giving an address.",
    "• MULTI-PART questions — when the customer asks about more than one thing (e.g. price AND availability), address EVERY part of their question. Never answer one and silently skip the other; if you can only answer some, cover those and offer to get the rest.",
    "• STAY ON THE QUESTION — answer ONLY what they asked. Do NOT volunteer a price, duration, or date they didn't ask about; an unrequested specific reads as off-topic and may be withheld anyway. If they ask about duration, talk about duration — not price.",
    "• 'WHICH ONE IS BEST FOR ME' and similar advice questions — do NOT deflect with price or a generic line. Briefly ask 1–2 quick qualifying questions (their need and goal), and recommend a suitable option from the Business context. This is guidance, not a brand-specific fact lookup.",
    "• NEVER REPEAT YOURSELF — do not send a message that just restates one you already sent in this chat. If the customer affirms ('yes', 'sure', 'tell me more') but you have no NEW grounded detail to add, do something DIFFERENT: ask a specific qualifying question, give the next concrete step, or offer to connect them with our team — never re-send your previous reply reworded.",
    coverage === "solid"
      ? "The Business context below HAS strong, relevant info — quote the actual specifics (numbers, names, dates) directly and confidently. But state a specific price, duration, date, or number ONLY if you can actually SEE it in the context: if the context covers the item yet not the exact detail asked, say you'll connect them with our team for that specific point — do NOT fill the gap from memory. Don't deflect on details the context DOES contain; offer to connect them with our team only as a helpful extra."
      : coverage === "thin"
      ? "The Business context below is THIN for this question — only a weak, partial match. Answer any GENERAL part naturally, but do NOT assert a specific price, duration, date, or policy from a single marginal chunk — it is likely the wrong item or an unrelated detail. State only what is unmistakably present, and for the exact specifics say you'll connect them with our team. Never fabricate to fill the gap."
      : "No Business context was found for this question. Do NOT state, guess, or imply any specific product, price, date, or policy about us. Still answer any GENERAL part of the message naturally, and for the brand-specific part ask which product/service/detail they mean or offer to connect the team — warmly, never a canned non-answer.",
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
    "• When listing 2+ items (products, steps, options), put each on its own line starting with the • character. Use *asterisks* to bold key terms like product/service names or prices.",
    "• When the Business context contains a relevant URL (product page, brochure, contact), include it as a bare link on its own line — never markdown [text](url).",
    "• Never prefix replies with your name, role, or labels (no 'SUPPORT:', no 'Maya:'). Just speak naturally.",
    "• NEVER introduce yourself by a personal name and never say 'I am <name>' / 'I'm <name>' / 'My name is <name>' / 'This is <name>'. You have NO personal name. If the persona above contains a name, IGNORE that name entirely. If asked who you are, say only that you're the business's AI assistant (you may use the business name from your context) — never a human first name.",
    "• End with one short, helpful follow-up question when it moves the conversation forward.",
  ].join("\n"));
  if (askPhone) parts.push([
    "--- Capture contact ---",
    "You don't have this person's phone number yet. If they show interest (ask about products, pricing, booking, a callback, or details), politely ask once for their WhatsApp number so the team can share details or call back — e.g. \"Could you share your WhatsApp number so our team can send you the details?\" Ask at most once and never pressure them; if they decline, carry on helpfully.",
  ].join("\n"));
  else if (haveNumber) parts.push([
    "--- Contact (already known) ---",
    "This is a WhatsApp chat, so you ALREADY have this person's phone number — it is the number they are messaging from. NEVER ask them for their phone, mobile, or WhatsApp number, and never ask them to \"share their number\" for a callback or to receive details — the team can already reach them right here. Early in the conversation, if you don't already know them (check the remembered-profile block above), warmly ask ONCE for their name and city in a single short, friendly question — but NEVER block or delay answering their actual question to get it. As soon as they share their name or city, call remember_customer to save it.",
  ].join("\n"));
  parts.push([
    "--- Product / service consistency ---",
    "If the customer has chosen or named a specific product/service/option (it may be in their remembered profile above or earlier in this chat), answer ONLY about THAT one. NEVER quote a different option's price, duration, dates, or details. If you are not sure which one they mean, ask them to confirm before giving specifics — do not guess.",
  ].join("\n"));
  if (hasCommerce) parts.push([
    "--- Selling & checkout ---",
    "This business sells products right here in chat. When the customer wants to buy or asks what's available, call list_products to show the items and prices. As they choose, call add_to_cart for each item (confirm the quantity), and use view_cart to recap on request. When they confirm they're ready to pay, call checkout and send them the payment link EXACTLY as it is returned — never invent, shorten, or alter a link, and never state a price the tools didn't give you. Their order is confirmed automatically once they pay. If checkout says online payment isn't set up, don't send a link — say the team will follow up to arrange payment.",
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
  // assistant's/agent's own name, or that the latest message is addressing.
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
  // Show the real name in the portal instead of "Website visitor" (web/IG/FB have
  // no contact record keyed by their opaque id, so updateContactProfile can't).
  if (name) await setConversationName(phone, name, tenantId).catch(() => undefined);
  const attrs: Record<string, string> = {};
  if (city) attrs.city = city;
  if (interest) attrs.interest = interest;
  if (Object.keys(attrs).length) await setContactAttributes(phone, attrs, tenantId).catch(() => undefined);
  // Mirror an AI-captured email/city onto the LSQ lead (same gap the flow had).
  if ((email || city) && phone.replace(/\D/g, "").length >= 10) {
    void syncLeadProfile({ phone, email: email || undefined, city: city || undefined, name: name || undefined }, tenantId);
  }
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

// ── Built-in commerce (cart → checkout) tools ──────────────────────────────
// Cross-channel conversational cart for Instagram & Messenger — WhatsApp keeps
// its native catalog cart (the whatsapp webhook's `order` handler). Enabled only
// when the caller passes a commerce context AND the tenant has products. Keyed by
// the contact id (`phone` — an IGSID/PSID on IG/Messenger), same key the cart,
// checkout, pay-link reconciliation, and recovery all use. Prices ALWAYS come
// from OUR catalog, never from anything the model or customer supplies.
export type CommercePlatform = "whatsapp" | "instagram" | "messenger" | "webchat";
export interface CommerceCtx { platform: CommercePlatform; conversationId?: string | null }

const CART_FNS = { list: "list_products", add: "add_to_cart", view: "view_cart", checkout: "checkout" } as const;
const COMMERCE_FN_NAMES = new Set<string>(Object.values(CART_FNS));
const COMMERCE_TOOLS: ChatTool[] = [
  { name: CART_FNS.list, description: "List the items available to buy from this business, with prices. Call this when the customer wants to shop, asks what's available, or before adding anything to the cart.", params: [], required: [] },
  { name: CART_FNS.add, description: "Add an item to the customer's cart. Use the item's name or SKU exactly as shown by list_products. Call once per distinct item.", params: [
    { name: "product", description: "The product name or SKU the customer wants to buy" },
    { name: "quantity", description: "How many (a whole number; defaults to 1)" },
  ], required: ["product"] },
  { name: CART_FNS.view, description: "Show what's currently in the customer's cart and the running total.", params: [], required: [] },
  { name: CART_FNS.checkout, description: "Place the order for everything in the cart and get a secure payment link. Call this ONLY after the customer confirms they want to check out / pay. Put the returned link in your reply EXACTLY as given — never invent one.", params: [], required: [] },
];

const money2 = (cents: number, ccy: string) => `${ccy} ${(cents / 100).toFixed(2)}`;

// Execute one commerce tool. Returns a plain-language status for the model, plus
// (on checkout) the pay-link URL so the caller can whitelist it past the
// grounding firewall. Never throws — a failure becomes a graceful status.
async function executeCommerceTool(
  name: string, args: Record<string, unknown>, phone: string, tenantId: string, ctx: CommerceCtx,
): Promise<{ status: string; payUrl?: string }> {
  try {
    if (name === CART_FNS.list) {
      const products = (await listProducts(tenantId)).filter(p => p.available);
      if (!products.length) return { status: "No products are available right now." };
      return { status: "Available items:\n" + products.map(p => `• ${p.name} — ${money2(p.priceCents, p.currency)}${p.retailerId ? ` (SKU ${p.retailerId})` : ""}`).join("\n") };
    }
    if (name === CART_FNS.add) {
      const query = String(args.product ?? "").trim();
      if (!query) return { status: "Ask the customer which item they'd like." };
      const qty = Math.max(1, Math.min(99, Math.round(Number(args.quantity) || 1)));
      const product = await findProductByQuery(query, tenantId);
      if (!product) {
        const names = (await listProducts(tenantId)).filter(p => p.available).map(p => p.name).slice(0, 20);
        return { status: `No item matches "${query}". Available: ${names.join(", ") || "none"}. Ask the customer to pick one.` };
      }
      const cart = await getOpenCart(phone, tenantId);
      const items = cart?.items ? [...cart.items] : [];
      const existing = items.find(i => i.productId === product.id);
      if (existing) existing.qty += qty; else items.push({ productId: product.id, name: product.name, qty, priceCents: product.priceCents });
      await upsertCart({ phone, platform: ctx.platform, conversationId: ctx.conversationId ?? null, items }, tenantId);
      const total = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
      return { status: `Added ${qty}× ${product.name}. Cart now: ${items.map(i => `${i.qty}× ${i.name}`).join(", ")}. Total ${money2(total, product.currency)}.` };
    }
    if (name === CART_FNS.view) {
      const cart = await getOpenCart(phone, tenantId);
      if (!cart?.items?.length) return { status: "The cart is empty." };
      const total = cart.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
      return { status: "Cart:\n" + cart.items.map(i => `• ${i.qty}× ${i.name} — ${money2(i.priceCents * i.qty, "INR")}`).join("\n") + `\nTotal ${money2(total, "INR")}.` };
    }
    if (name === CART_FNS.checkout) {
      const cart = await getOpenCart(phone, tenantId);
      if (!cart?.items?.length) return { status: "The cart is empty — add items before checking out." };
      const res = await checkoutCart({ phone }, tenantId);
      if (!res) return { status: "The cart is empty — add items before checking out." };
      if (res.paymentUrl) return { status: `Order placed (total ${money2(res.totalCents, "INR")}). Payment link: ${res.paymentUrl} — send this exact link to the customer. Their order confirms automatically once they pay.`, payUrl: res.paymentUrl };
      return { status: `Order #${res.orderId.slice(0, 8)} placed for ${money2(res.totalCents, "INR")}. Online payment isn't set up — tell the customer our team will reach out to arrange payment and confirm the order.` };
    }
  } catch (err) {
    console.error("[llm] commerce tool failed:", name, err);
    return { status: "Something went wrong with the cart — apologise briefly and offer to connect the customer with the team." };
  }
  return { status: "unknown function" };
}

export interface ReplyResult {
  reply: string | null;     // null when escalating
  escalate: boolean;
  reason?: string;
  usedChunks: number;
  functionCalls?: string[]; // names of AI functions executed this turn
  // Grounding metadata (success path) — for telemetry + the async semantic auditor.
  context?: string;            // the retrieved context this reply was allowed to draw from
  coverageBand?: CoverageBand; // how strongly the KB covered the question
  topSim?: number;             // best chunk similarity
  chunkSims?: number[];        // all relevant chunk similarities
  groundingActions?: GroundingAction[];  // what the firewall rewrote/stripped/deferred
}

// Persona-label / self-intro scrubbing + the contact-email guard moved to
// src/lib/guard/sanitize.ts so every outbound path shares ONE chokepoint
// (sanitizeOutbound). They are re-exported above for back-compat.

// Build the text we EMBED for RAG retrieval. A message is anaphoric/elliptical —
// it leans on the prior turn for its subject — when it OPENS with a back-reference
// ("and the duration?", "what about placements", "tell me more", "that one") or is
// a BARE aspect word with no subject of its own ("fees?", "duration",
// "placements?"). We fuse ONLY these with the single prior user turn. A
// self-contained question — even a short one like "Python course fees?" — carries
// its own subject and must retrieve on its own terms, so we must NOT fuse it (that
// would drift it toward the prior topic).
const FOLLOWUP_OPENER = /^(?:and|also|but|what about|how about|what if|tell me more|tell me|more|elaborate|go on|continue|that one|that|this|it|they|them|those|same|again|ok(?:ay)?|yes|yeah|yep|sure|cool)\b/i;
const BARE_ASPECT = /^(?:cost|costs|price|pricing|fees?|fee structure|duration|timing|timings|availability|placements?|syllabus|curriculum|eligibility|scope|salary|certificate|certification|emi|discount|scholarship|warranty|returns?|refund|policy|delivery|shipping|features?|specs?|specifications?|sizes?|colou?rs?|stock|location|hours|menu|inclusions?|itinerary|details?|info|more info)\s*\??$/i;

export function retrievalQuery(history: { role: "user" | "assistant"; body: string }[]): string {
  const userTurns = history.filter(m => m.role === "user" && m.body?.trim());
  const last = userTurns[userTurns.length - 1]?.body.trim() ?? "";
  if (!last) return "";
  if (!FOLLOWUP_OPENER.test(last) && !BARE_ASPECT.test(last)) return last;   // self-contained → on its own terms
  const prev = userTurns[userTurns.length - 2]?.body.trim();
  return prev ? `${prev} ${last}`.slice(0, 400) : last;
}

// Generates a grounded reply, then screens it through the content-safety layer
// before any caller can send it. EVERY channel's AI reply (WhatsApp, Instagram,
// Messenger, web chat, YouTube comments) funnels through this one function, so
// wrapping it here is the single place that covers all of them — rather than
// eight scattered pre-send checks that a new channel could forget to add.
//
// A blocked reply becomes an escalation, not silence: the customer's message
// lands with a human instead of the conversation dead-ending.
export async function generateReply(history: { role: "user" | "assistant"; body: string; mediaUrl?: string | null; mediaType?: string | null }[], phone?: string, agentId?: string | null, tenantId = "00000000-0000-0000-0000-000000000001", primaryKbTag?: string | null, askPhone = false, commerce?: CommerceCtx): Promise<ReplyResult> {
  const result = await generateReplyUnmoderated(history, phone, agentId, tenantId, primaryKbTag, askPhone, commerce);
  if (!result.reply) return result;
  const verdict = await moderateText(result.reply, { tenantId, surface: "ai_reply" });
  if (verdict.allowed) return result;
  return { reply: null, escalate: true, reason: `blocked by safety filter (${verdict.reason})`, usedChunks: result.usedChunks };
}

// The unscreened generator. Private on purpose — callers must go through
// generateReply() above so nothing can send AI text that skipped moderation.
async function generateReplyUnmoderated(history: { role: "user" | "assistant"; body: string; mediaUrl?: string | null; mediaType?: string | null }[], phone?: string, agentId?: string | null, tenantId = "00000000-0000-0000-0000-000000000001", primaryKbTag?: string | null, askPhone = false, commerce?: CommerceCtx): Promise<ReplyResult> {
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
  // Cross-channel cart: enable the built-in commerce tools only when the caller
  // opts in (IG/Messenger) AND we have a contact key + at least one available
  // product. WhatsApp uses its native catalog cart, so it doesn't opt in.
  const commerceOn = !!commerce && !!phone;
  const products = commerceOn ? await listProducts(tenantId).catch(() => []) : [];
  const hasCommerce = commerceOn && products.some(p => p.available);

  // Configured AI functions + a built-in "remember" tool so the model can
  // persist the customer's name/details, plus the commerce tools when enabled.
  // `functions` stays the configured list (the no-context guard keys off it).
  const tools: ChatTool[] = [...(toChatTools(functions) ?? []), MEMORY_TOOL, ...(hasCommerce ? COMMERCE_TOOLS : [])];

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
  const chunkSims = relevant.map(c => c.similarity);
  const topSim = chunkSims.length ? Math.max(...chunkSims) : 0;
  const coverage = coverageBand(chunkSims);

  // NOTE: we deliberately do NOT short-circuit to a canned reply when there's no
  // KB context / no agent. The grounding rules let the model greet, make small
  // talk, and answer GENERAL questions from its own knowledge while refusing to
  // invent brand-specific facts — so a plain "hi" gets a natural reply instead of
  // the old "I didn't get that". The model is always given the chance to respond.

  // What we already know about this person — injected so the AI recognises
  // returning customers and never re-asks for details already on file.
  const contact = phone ? await getContactByPhone(phone, tenantId).catch(() => null) : null;
  const profile = knownProfile(contact);

  // Annotate weak chunks so the model sees the evidence strength inline, not just
  // a wall of equally-authoritative-looking text.
  const context = relevant.map((c, i) => `[${i + 1}${c.similarity < 0.55 ? " · weak" : ""}] ${c.content}`).join("\n\n");
  // Zero-cost behaviour read → adapts tone + next step (educate / convert / de-escalate).
  const behavior = behaviorBlock(readBehavior(history));
  const system = systemPrompt(context, agent, tools.length > 0, profile, askPhone, !!phone && !askPhone, behavior, coverage, hasCommerce);

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
    // Pay-link URLs minted by the checkout tool this turn — whitelisted past the
    // grounding firewall (which otherwise strips any link not in the RAG context).
    const payLinks: string[] = [];
    // Same problem, prices: the catalog/cart figures the commerce tools handed the
    // model came from OUR tables, so they're grounded by definition — but the
    // firewall only trusts the RAG context and would defer the whole sentence.
    const toolFacts: string[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // Ample token headroom so a heavy thinking pass (which counts against the
      // output budget on thinking models) can never starve and truncate the visible
      // reply mid-sentence. Replies stay short via the prompt + firewall. Tune with
      // GEMINI_CHAT_MAX_TOKENS.
      const maxTokens = Math.max(512, parseInt(process.env.GEMINI_CHAT_MAX_TOKENS ?? "", 10) || 2048);
      const res = await runChat({ provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system: systemWithMedia, turns, tools, maxTokens, timeoutMs: sawMedia ? 60000 : undefined });

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
          if (hasCommerce && commerce && phone && COMMERCE_FN_NAMES.has(c.name)) {
            const r = await executeCommerceTool(c.name, c.args, phone, tenantId, commerce);
            if (r.payUrl) payLinks.push(r.payUrl);
            toolFacts.push(r.status);
            executed.push(c.name);
            results.push({ id: c.id, name: c.name, status: r.status });
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

      // Single outbound chokepoint: strip any persona label + enforce that every
      // high-risk specific (contact, price, %, duration…) traces to the retrieved
      // context or the approved contact config — else rewrite/strip/defer it.
      // A freshly minted pay link is legitimately not in the RAG context — add it
      // to the allow-set so the firewall keeps it (its domain becomes grounded).
      // The commerce tools' own output joins it for the same reason: those prices
      // are read straight from the tenant's catalog and cart, so a reply quoting
      // them was otherwise deferred to "our team will share the exact fees".
      let guardContext = payLinks.length ? `${context}\nPayment links: ${payLinks.join(" ")}` : context;
      if (toolFacts.length) guardContext += `\nFrom our catalog and cart:\n${toolFacts.join("\n")}`;
      const guarded = sanitizeOutbound((res.text ?? "").trim(), { agentName: agent?.name, context: guardContext, approvedEmail: PUBLIC_CONTACT_EMAIL, approvedPhones: APPROVED_PHONES, questionHint: lastUser.body });
      const text = guarded.text;
      if (guarded.actions.length) console.log(JSON.stringify({ tag: "grounding_guard", coverage, topSim: Number(topSim.toFixed(3)), actions: guarded.actions }));
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
      return { reply: text, escalate: escalateViaFn, reason: escalateViaFn ? "function handoff" : undefined, usedChunks: relevant.length, functionCalls: executed, context, coverageBand: coverage, topSim, chunkSims, groundingActions: guarded.actions };
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

// Compose a short, context-aware re-engagement nudge for a chat that has gone
// quiet (we sent the last message — often a question — and the customer never
// replied). Single-shot via the tenant's chat provider, NO retrieval and NO
// tools: the only facts allowed are what was already said, so the grounding
// firewall validates against the transcript itself and strips any invented
// price/date/email/link. The caller owns the 24h-window + bot-enabled + opt-out
// gating; this only writes the text. Returns null when there's nothing safe to
// send (empty output, fully stripped, or the tenant has no AI key).
export async function composeFollowup(
  history: { role: "user" | "assistant"; body: string }[],
  opts: { tenantId?: string; agentName?: string | null; customerName?: string | null } = {},
): Promise<{ text: string; groundingActions: GroundingAction[] } | null> {
  const tenantId = opts.tenantId ?? "00000000-0000-0000-0000-000000000001";
  const transcript = (history ?? []).filter(m => m.body?.trim()).slice(-12);
  if (!transcript.length) return null;
  const convText = transcript.map(m => `${m.role === "user" ? "Customer" : "Us"}: ${m.body.trim()}`).join("\n");
  // The customer's real name comes ONLY from the stored record — this composer
  // gets no "remembered profile" block (unlike generateReply), so left to itself
  // it improvises a name off the transcript and shortens it ("Priyesh" → "Pri").
  // Give it the exact name and forbid nicknaming; if we have no usable name (empty,
  // a placeholder, or phone-like), tell it to address no one by name at all.
  const nm = (opts.customerName ?? "").trim();
  const usableName = nm && /\p{L}/u.test(nm) && !/^\+?[\d\s()+-]+$/.test(nm) ? nm : "";
  const nameRule = usableName
    ? `• If you address them by name, use EXACTLY "${usableName}" — copy it verbatim. NEVER shorten it, nickname it, abbreviate it to initials, or swap in any other name. When unsure, use no name at all.`
    : "• Do NOT address them by any name — you don't reliably know it, so never guess, shorten, or invent one.";
  const system = [
    "You are the SAME business assistant continuing an existing chat — not a new conversation.",
    "The customer has gone quiet: they did not reply to your last message. Write ONE brief, warm follow-up nudge to gently re-engage them.",
    "RULES:",
    "• 1–2 short sentences. Friendly and low-pressure — never pushy, needy, or guilt-trippy.",
    "• This is a CONTINUATION: do NOT greet from scratch, do NOT open with hi/hello as if it's first contact, and NEVER introduce yourself by any name.",
    nameRule,
    "• If your last message asked a question, gently re-offer to help with that. Otherwise, lightly check whether they have any questions.",
    "• Introduce NO new facts — no prices, fees, dates, durations, phone numbers, email addresses, links, or claims that aren't already present in the conversation above. If you have nothing specific to add, stay general ('just checking if you had any questions about …').",
    "• Reply in the SAME language the customer was using (English by default; clean Hinglish in Latin script only if they wrote Hinglish).",
    "• Output ONLY the message text — no quotes, no labels, no preamble.",
  ].join("\n");
  let res;
  try {
    const ai = await resolveTenantAi(tenantId);
    res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system,
      turns: [{ role: "user", text: `--- Conversation so far ---\n${convText}\n\n--- Your follow-up nudge ---` }],
      maxTokens: 160,
    });
  } catch { return null; }   // no key / busy / unavailable — skip this nudge, never block the cron
  const raw = (res.text ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (raw.length < 2) return null;
  // Grounding firewall: the transcript is the ONLY allowed source of facts, so any
  // invented specific is stripped/deferred exactly as on the live reply path. This
  // also scrubs any accidental self-introduction by name.
  const guarded = sanitizeOutbound(raw, { agentName: opts.agentName ?? undefined, context: convText, approvedEmail: PUBLIC_CONTACT_EMAIL, approvedPhones: APPROVED_PHONES });
  const text = guarded.text.trim();
  if (text.length < 2) return null;
  // Screened like any other outbound AI text — a follow-up nudge is sent
  // unprompted, so a bad one is worse than a bad reply, not better.
  if (!(await moderateText(text, { tenantId, surface: "ai_reply" })).allowed) return null;
  return { text, groundingActions: guarded.actions };
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
      "Preserve any URL/link EXACTLY, as a bare link (never markdown) — never drop, shorten, or alter it.",
      "Output ONLY the reply text.",
    ].filter(Boolean).join("\n\n");
    const res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system,
      turns: [{ role: "user", text: `CUSTOMER MESSAGE:\n${userMessage}\n\nFACTUAL ANSWER:\n${answer}` }],
      maxTokens: 512,
    });
    // Sanitize against the ORIGINAL factual answer as the allow-set: the persona
    // rewrite must not introduce an email/number/duration that wasn't in the
    // curated source (a tone pass occasionally invents a contact line).
    const toned = sanitizeOutbound(res.text || answer, { agentName: agent.name, context: answer, approvedEmail: PUBLIC_CONTACT_EMAIL, approvedPhones: APPROVED_PHONES, questionHint: userMessage }).text;
    // This is a SECOND model generation, steered by the tenant's own persona and
    // constraints text — so its output needs screening independently of
    // generateReply's. Falling back to the curated `answer` (rather than failing
    // the send) mirrors the catch below: the customer still gets a correct reply,
    // just without the persona rewrite.
    if (!(await moderateText(toned, { tenantId, surface: "ai_reply" })).allowed) return answer;
    return toned;
  } catch (err) {
    // AiKeyMissingError, rate limits, etc. — never block; serve the raw answer.
    console.error("[llm] persona tone failed (serving raw answer):", err);
    return answer;
  }
}

// ── Conversation brief ─────────────────────────────────────────────────────────
// An adaptive, at-a-glance summary of ONE conversation. Not every chat is a sales
// lead — the model first CLASSIFIES the conversation (sales, support, a knowledge
// seeker, feedback, spam, general), then summarises it the way that category
// deserves, choosing category-appropriate highlight fields instead of forcing a
// sales frame onto e.g. a spiritual seeker. Uses the tenant's own chat provider.
export type BriefCategory = "sales" | "support" | "seeker" | "feedback" | "spam" | "general";
const BRIEF_CATEGORIES: BriefCategory[] = ["sales", "support", "seeker", "feedback", "spam", "general"];

export interface ConversationBrief {
  category: BriefCategory;
  categoryLabel: string;              // short human badge, specific to this person
  priority: "high" | "medium" | "low";
  summary: string;
  highlights: { label: string; value: string }[];   // category-appropriate facets
  nextStep: string;
  talkingPoints: string[];
}

export async function generateConversationBrief(context: string, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<ConversationBrief> {
  const ai = await resolveTenantAi(tenantId);
  const instruction =
    `Read the context below (chat history, collected details, campaigns received, links tapped) and produce a ` +
    `concise brief for whoever handles this conversation. It is NOT always a sales lead — FIRST classify what ` +
    `kind of conversation this is, THEN summarise it the way that category deserves.\n\n` +
    `Categories (pick the single best fit):\n` +
    `- "sales": shows buying interest — asks price/plans/enrolment, wants to purchase or book.\n` +
    `- "support": an existing customer/user needing help, reporting an issue, or asking how something works.\n` +
    `- "seeker": seeking knowledge, guidance, or the content this account shares (e.g. spiritual/educational questions) with no commercial intent.\n` +
    `- "feedback": praise, a complaint, or a suggestion about the brand or its content.\n` +
    `- "spam": irrelevant, promotional, abusive, or bot-like messages.\n` +
    `- "general": a casual greeting or vague message that doesn't fit the above yet.\n\n` +
    `Rules:\n` +
    `- Ground everything ONLY in the context. Never invent facts. If a fact is unknown, say "Unknown".\n` +
    `- "categoryLabel": 2-4 words naming the category specifically for THIS person (e.g. "Sales lead", "Refund request", "Gita seeker", "Positive feedback", "Spam / promo", "Just saying hi").\n` +
    `- "priority": "high" if it needs prompt human attention (hot buyer, angry complaint, urgent issue), "medium" if worth a timely reply, "low" if casual or no action needed.\n` +
    `- "summary": 1-2 sentences — who they are and where this conversation stands.\n` +
    `- "highlights": 2-5 {label,value} pairs that matter FOR THIS category. Pick fitting labels, e.g.\n` +
    `    sales → Interested in, Intent, Objections, Urgency\n` +
    `    support → Issue, Product/area, Urgency, Status\n` +
    `    seeker → Seeking, Topics discussed, Engagement\n` +
    `    feedback → Sentiment, About, Their ask\n` +
    `    spam/general → keep to 1-2 (e.g. Why flagged, Message gist)\n` +
    `  Use "Unknown" or "None surfaced" when a chosen facet has no info.\n` +
    `- "nextStep": the single best next action, phrased FOR THIS category (a seeker gets "Answer their question / share the requested chapter", not "qualify their interest").\n` +
    `- "talkingPoints": 2-4 short phrases to open or steer the reply. Use [] for spam.\n` +
    `Return ONLY JSON: {"category","categoryLabel","priority","summary","highlights":[{"label","value"}],"nextStep","talkingPoints":[]}.`;

  const res = await runChat({
    provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
    system: "You are a conversation-intelligence assistant for a customer-messaging platform. You classify and summarise ANY kind of conversation — sales, support, knowledge-seeking, feedback, or spam. You output ONLY valid JSON — no markdown fences, no preamble.",
    turns: [{ role: "user", text: `${instruction}\n\n--- CONVERSATION CONTEXT ---\n${context}` }],
    maxTokens: 1024,
  });

  const raw = (res.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  let parsed: Partial<ConversationBrief> = {};
  try { parsed = JSON.parse(raw) as Partial<ConversationBrief>; } catch { /* fall through to defaults */ }
  const category = BRIEF_CATEGORIES.includes(parsed.category as BriefCategory) ? (parsed.category as BriefCategory) : "general";
  const priority = parsed.priority === "high" || parsed.priority === "low" ? parsed.priority : "medium";
  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
        .map(h => ({ label: String((h as { label?: unknown })?.label ?? "").trim(), value: String((h as { value?: unknown })?.value ?? "").trim() }))
        .filter(h => h.label && h.value)
        .slice(0, 5)
    : [];
  const DEFAULT_LABEL: Record<BriefCategory, string> = {
    sales: "Sales lead", support: "Support", seeker: "Seeker", feedback: "Feedback", spam: "Spam", general: "General",
  };
  return {
    category,
    categoryLabel: (parsed.categoryLabel ?? "").toString().trim() || DEFAULT_LABEL[category],
    priority,
    summary: (parsed.summary ?? "").toString().trim() || "Not enough conversation yet to summarise this thread.",
    highlights,
    nextStep: (parsed.nextStep ?? "").toString().trim() || "Read the thread and reply appropriately.",
    talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints.map(t => String(t).trim()).filter(Boolean).slice(0, 4) : [],
  };
}

// ── Review reply ───────────────────────────────────────────────────────────────
// Draft a public reply to a business review, tuned to the star rating: a warm
// thank-you for high ratings, an empathetic service-recovery for low ones. Uses
// the tenant's own chat provider; throws AiKeyMissingError if unconfigured.
export interface ReviewReplyInput {
  author?: string;
  rating: number;              // 1..5
  text: string;                // the review body
  businessName?: string;       // for tone; never invented into promises
  tone?: string;               // freeform brand/tone guidance
  signature?: string;          // appended verbatim if provided (e.g. "— Team X")
}

export async function generateReviewReply(input: ReviewReplyInput, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<string> {
  const ai = await resolveTenantAi(tenantId);
  const rating = Math.min(5, Math.max(1, Math.round(input.rating) || 3));
  const band = rating >= 4 ? "positive" : rating === 3 ? "mixed" : "negative";
  const guide: Record<typeof band, string> = {
    positive: "Warmly thank them by name, echo ONE specific thing they praised, and invite them back. Keep it genuine, not gushing.",
    mixed: "Thank them for the honest feedback, acknowledge the specific thing that fell short, note any positive, and offer to make it better. Balanced and sincere.",
    negative: "Lead with a sincere apology, take it seriously WITHOUT admitting legal fault or inventing facts, acknowledge their specific issue, and offer to make it right — invite them to continue privately (e.g. a call/DM/email) rather than debating in public.",
  };
  const instruction =
    `Write a SHORT public reply (2-4 sentences, under 80 words) from the business to this ${rating}-star review.\n\n` +
    `Rules:\n` +
    `- Ground ONLY in what the review says. NEVER invent facts, offers, discounts, names, or details not present.\n` +
    `- Address the reviewer by first name if given; otherwise a warm neutral greeting.\n` +
    `- Tone for a ${band} (${rating}★) review: ${guide[band]}\n` +
    `- Sound human and specific to THIS review — not a generic template. No hashtags, no emoji spam (at most one, only if it fits).\n` +
    `- Never share or request sensitive personal data publicly.\n` +
    (input.tone ? `- Brand voice guidance: ${input.tone}\n` : "") +
    (input.signature ? `- End with this signature on its own line, verbatim: "${input.signature}"\n` : "") +
    `Return ONLY the reply text — no preamble, no quotes around it.`;

  const ctx =
    `Business: ${input.businessName || "(unspecified)"}\n` +
    `Reviewer: ${input.author?.trim() || "(anonymous)"}\n` +
    `Rating: ${rating} / 5\n` +
    `Review: ${(input.text || "").trim() || "(no text — rating only)"}`;

  const res = await runChat({
    provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
    system: "You write concise, sincere, on-brand public replies to customer reviews for a business. You never invent facts and never over-promise. You output ONLY the reply text.",
    turns: [{ role: "user", text: `${instruction}\n\n--- REVIEW ---\n${ctx}` }],
    maxTokens: 400,
  });
  const reply = (res.text ?? "").trim().replace(/^["']|["']$/g, "").trim();
  // Throws rather than returning empty: the poller's catch leaves the review
  // at replyStatus "none" for a human, which is the right outcome here — an
  // empty string would post a blank public reply on the business's profile.
  const verdict = await moderateText(reply, { tenantId, surface: "review_reply" });
  if (!verdict.allowed) throw new Error(`review reply blocked by safety filter (${verdict.reason})`);
  return reply;
}

// ── Outreach opener ────────────────────────────────────────────────────────────
// A SHORT private-DM opener for a lead the tenant found themselves (e.g. via the
// browser extension's "Find leads" page scan on Reddit/X/LinkedIn/Discord). This
// is the first line of a cold DM, not a public reply — grounded only in the
// post's own text, never a pitch. Uses the tenant's own chat provider; throws
// AiKeyMissingError if unconfigured.
export interface OutreachOpenerInput {
  text: string;               // the post/comment that flagged as a signal
  author?: string;
  platform?: string;          // "reddit" | "x" | "linkedin" | "discord" | "web"
  category?: string;          // e.g. "recommendation-ask", "pain-point" — see extension/src/signals.js
}

export async function generateOutreachOpener(input: OutreachOpenerInput, tenantId = "00000000-0000-0000-0000-000000000001"): Promise<string> {
  const ai = await resolveTenantAi(tenantId);
  const instruction =
    `Write the OPENING line(s) of a private DM (1-2 sentences, under 40 words) to someone who posted this ` +
    `on ${input.platform || "a social platform"}.\n\n` +
    `Rules:\n` +
    `- Ground ONLY in what they actually wrote. NEVER invent facts, shared history, or familiarity with them.\n` +
    `- Reference the SPECIFIC thing they said — not a generic "saw your post" opener.\n` +
    `- This is a cold DM opener, not a sales pitch: no product name, no link, no "check out", no discount, no CTA to buy.\n` +
    `- End with a genuine, low-pressure question or offer to help — something that invites a reply.\n` +
    `- Sound like a real person who read their post, not a template. No hashtags, no emoji.\n` +
    `Return ONLY the opener text — no preamble, no quotes around it.`;

  const ctx =
    `Platform: ${input.platform || "(unspecified)"}\n` +
    `Author: ${input.author?.trim() || "(unknown)"}\n` +
    `What they posted: ${(input.text || "").trim()}`;

  const res = await runChat({
    provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
    system: "You write short, specific, non-salesy opening lines for cold outreach DMs. You never invent facts and never pitch a product in the opener. You output ONLY the opener text.",
    turns: [{ role: "user", text: `${instruction}\n\n--- POST ---\n${ctx}` }],
    maxTokens: 200,
  });
  const opener = (res.text ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const verdict = await moderateText(opener, { tenantId, surface: "dm_reply" });
  if (!verdict.allowed) throw new Error(`outreach opener blocked by safety filter (${verdict.reason})`);
  return opener;
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
    `You are a sharp growth/operations advisor briefing the CEO of a business that runs customer messaging ` +
    `across WhatsApp, Instagram, Facebook Messenger and a website live-chat widget (broadcasts, chatbot flows, ` +
    `drip sequences, an AI assistant, and a CRM). Read the ` +
    `metrics below (this week vs last week + current totals) and give a holistic, decision-ready brief.\n\n` +
    `Rules:\n` +
    `- Be specific and grounded ONLY in the numbers given. Cite the actual figures/percentages.\n` +
    `- IMPORTANT: "Messages sent" counts OUTBOUND BROADCASTS only (WhatsApp template blasts). It is NOT total ` +
    `engagement. Two-way engagement = inbound replies, AI auto-replies, and active conversations across ALL ` +
    `channels (WhatsApp, Instagram, Messenger, Website live-chat). Never say engagement has "stalled"/"stopped" ` +
    `or mark the business at-risk merely because broadcasts are zero/low when replies and active conversations ` +
    `are healthy — a business can run entirely on inbound + live chat with no broadcasts.\n` +
    `- "health": "strong" (growing + healthy rates), "steady" (flat/ok), or "at-risk" (poor delivery/read on ` +
    `broadcasts actually sent, rising opt-outs/failures/escalations, a backlog awaiting reply, or replies AND ` +
    `active conversations both collapsing).\n` +
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
