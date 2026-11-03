// When may an AI reply to a Google review go public without a person?
//
// The star threshold alone isn't enough: a five-star review can still say "the
// food was great but I was charged twice", and a public auto-reply to that is
// exactly what an owner doesn't want. So every review is also read for topics
// that need a human — billing disputes, safety, legal threats, personal data,
// strong complaints — by fixed phrase rules here AND by the AI that drafts the
// reply. Either one raising a topic holds the reply for approval. When the
// review can't be read with confidence (a language the rules don't cover, an AI
// answer that doesn't parse, no AI at all), it is held too.
//
// Order of precedence: "Never auto-post" beats everything; then the rating
// threshold; then topics; then uncertainty. A high rating never overrides a
// topic hold. Pure: no I/O, so the poller, the preview screen and tests share it.

export type HoldCategory = "billing" | "safety" | "legal" | "personal_info" | "strong_complaint";
export const HOLD_CATEGORIES: HoldCategory[] = ["billing", "safety", "legal", "personal_info", "strong_complaint"];

export const HOLD_LABELS: Record<HoldCategory, { label: string; hint: string }> = {
  billing: { label: "Refunds, billing disputes or overcharging", hint: "e.g. “charged twice”, “want my money back”" },
  safety: { label: "Injury, safety or a serious service failure", hint: "e.g. “got sick”, “allergic reaction”, “cockroach”" },
  legal: { label: "Legal threats or allegations", hint: "e.g. “consumer court”, “fraud”, “police”" },
  personal_info: { label: "Personal or sensitive information", hint: "e.g. a phone number, email, medical details" },
  strong_complaint: { label: "Strong complaints, even with 4–5 stars", hint: "e.g. “rude staff”, “never again”, “worst”" },
};

export type HoldFor = Record<HoldCategory, boolean>;
export const DEFAULT_HOLD_FOR: HoldFor = { billing: true, safety: true, legal: true, personal_info: true, strong_complaint: true };

export function normalizeHoldFor(v: unknown): HoldFor {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(HOLD_CATEGORIES.map(k => [k, typeof o[k] === "boolean" ? o[k] : true])) as HoldFor;
}

// Phrase rules — English, Hindi and the Hinglish customers actually write.
// They are deliberately broad: a false alarm costs one tap to approve; a miss
// posts an AI reply under a complaint in public.
const RULES: Record<HoldCategory, RegExp[]> = {
  billing: [
    /\b(refunds?|refunded|money back|overcharg\w*|over-charg\w*|charged (me )?(twice|extra|double|more)|double charg\w*|extra charges?|hidden (charges?|fees?)|wrong bill|bill (was )?wrong|billing (issue|problem|error)|rip[- ]?off|paisa wapas|paise wapas|refund nahi|zyada paise|extra paise)\b/i,
    /(रिफंड|पैसे वापस|पैसा वापस|ज़्यादा पैसे|ज्यादा पैसे|बिल गलत)/,
  ],
  safety: [
    /\b(injur\w*|hurt me|got hurt|burn(ed|t)|allerg\w*|food poison\w*|poison\w*|fell sick|got sick|made (me|us) sick|vomit\w*|diarrh?o?ea|hospitali[sz]\w*|hospital|unsafe|dangerous|infection|infected|bleed\w*|rash|cockroach\w*|insects?|worms?|rotten|stale|expired|fainted|accident|bimar|ulti)\b/i,
    /(बीमार|उल्टी|जल गया|कॉकरोच|सड़ा|एलर्जी|चोट)/,
  ],
  legal: [
    /\b(lawyers?|advocate|legal (action|notice)|sue|suing|court|police|fir|consumer (forum|court|helpline)|fraud\w*|scam\w*|cheat\w*|harass\w*|discriminat\w*|defam\w*|reported (you|them)|complain(t|ed)? to the|dhokha|thag\w*)\b/i,
    /(धोखा|पुलिस|कोर्ट|अदालत|वकील|ठग|उपभोक्ता)/,
  ],
  personal_info: [
    /[\w.+-]+@[\w-]+\.[\w.]+/,
    /(?:\+?\d[\s-]?){10,}/,
    /\b(aadhaa?r|pan card|passport (number|no)|card (number|ending)|account number|otp|upi id|my address|diagnos\w*|prescription|medical report|test report)\b/i,
    /(आधार|पैन कार्ड|पासवर्ड|ओटीपी)/,
  ],
  strong_complaint: [
    /\b(worst|terrible|horrible|pathetic|disgusting|awful|never (again|coming back|recommend\w*)|rude\w*|misbehav\w*|waste of (money|time)|disappoint\w*|unprofessional|do not (go|visit|recommend)|don'?t (go|visit|recommend)|not (happy|satisfied|recommended)|unhappy|careless|negligen\w*|bakwas|ghatiya|bekaa?r|faltu|kharab|bura)\b/i,
    /(बकवास|घटिया|बेकार|खराब|बुरा|बदतमीज़|बदतमीज)/,
  ],
};

// Letters outside Latin and Devanagari: the rules can't read them, so the
// review is "unclear" and always waits for a person.
const LETTER = /\p{L}/gu;
const READABLE = /[\p{Script=Latin}\p{Script=Devanagari}]/u;

/** Topics the phrase rules find, with the phrase that triggered each. Pure. */
export function ruleTopics(text: string): { category: HoldCategory; phrase: string }[] {
  const out: { category: HoldCategory; phrase: string }[] = [];
  for (const category of HOLD_CATEGORIES) {
    for (const re of RULES[category]) {
      const m = text.match(re);
      if (m) { out.push({ category, phrase: category === "personal_info" ? "personal details" : m[0].trim().slice(0, 40) }); break; }
    }
  }
  return out;
}

export function unreadableLanguage(text: string): boolean {
  for (const ch of text.match(LETTER) ?? []) if (!READABLE.test(ch)) return true;
  return false;
}

/** What the drafting AI said about the review; null when no AI read it. */
export interface AiRead { concerns: HoldCategory[]; confident: boolean }

export interface PolicyInput {
  rating: number;                 // 1–5, 0 = Google didn't say
  text: string;
  autoMinStars: number;           // 6 = never auto-post
  holdFor: HoldFor;
  ai: AiRead | null;
}

export interface PolicyDecision {
  autoPost: boolean;
  /** Short, owner-facing explanations, most important first. Empty when it may auto-post. */
  reasons: string[];
  /** Topics found by rules or AI (whether or not the owner holds for them). */
  topics: HoldCategory[];
  /** Feedback someone should look at: low stars, or a complaint topic. */
  complaint: boolean;
}

const NEVER = 6;
const COMPLAINT_TOPICS: HoldCategory[] = ["billing", "safety", "legal", "strong_complaint"];

export function decideAutoPost(p: PolicyInput): PolicyDecision {
  const reasons: string[] = [];
  const found = ruleTopics(p.text);
  const aiTopics = (p.ai?.concerns ?? []).filter(c => HOLD_CATEGORIES.includes(c));
  const topics = [...new Set([...found.map(f => f.category), ...aiTopics])];

  if (p.autoMinStars >= NEVER) reasons.push("“Never auto-post” is on.");
  if (!p.rating) reasons.push("Google didn't give a star rating.");
  else if (p.autoMinStars < NEVER && p.rating < p.autoMinStars) reasons.push(`${p.rating}★ is below your auto-post setting (${p.autoMinStars}★ and up).`);

  for (const c of topics) {
    if (!p.holdFor[c]) continue;
    const phrase = found.find(f => f.category === c)?.phrase;
    reasons.push(`${HOLD_LABELS[c].label}${phrase ? ` — mentions “${phrase}”` : " — flagged by the AI"}.`);
  }

  if (unreadableLanguage(p.text)) reasons.push("Written in a language Talko can't check automatically.");
  if (!p.ai) reasons.push("Couldn't check this review automatically.");
  else if (!p.ai.confident) reasons.push("The AI wasn't sure how to read this review.");

  return {
    autoPost: reasons.length === 0,
    reasons,
    topics,
    complaint: (p.rating > 0 && p.rating <= 2) || topics.some(t => COMPLAINT_TOPICS.includes(t)),
  };
}

/** Reads the drafting AI's JSON answer. Anything unexpected → null (held). Pure. */
export function parseAiDraft(raw: string): { reply: string; ai: AiRead | null } {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const j = JSON.parse(body) as { reply?: unknown; concerns?: unknown; confident?: unknown };
    const reply = typeof j.reply === "string" ? j.reply.trim() : "";
    if (!reply) return { reply: "", ai: null };
    const concerns = Array.isArray(j.concerns) ? j.concerns.filter((c): c is HoldCategory => HOLD_CATEGORIES.includes(c as HoldCategory)) : [];
    if (!Array.isArray(j.concerns) || typeof j.confident !== "boolean") return { reply, ai: null };
    return { reply, ai: { concerns, confident: j.confident } };
  } catch {
    // Plain text instead of JSON: usable as a draft, but unchecked.
    const plain = body.replace(/^["']|["']$/g, "").trim();
    return { reply: plain.startsWith("{") ? "" : plain, ai: null };
  }
}
