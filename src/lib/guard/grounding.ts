// ── GroundingFirewall ─────────────────────────────────────────────────────────
// A deterministic, zero-LLM, sub-millisecond post-generation guard. The rule it
// enforces: a reply may only state a HIGH-RISK SPECIFIC — a contact detail, a
// price, a percentage, a duration, a date — that traces back to the retrieved
// Business context (its "allow-set") or the business's approved contact config.
// Anything else is the model inventing a fact, so we rewrite it to the approved
// contact, strip it, or replace the offending sentence with a safe deferral.
//
// This generalizes the per-symptom email scrub: a NEW hallucination class is one
// new extractor in CLASSES below, not a new patch scattered across the codebase.
// Dispositions fail SAFE — when in doubt we defer to the human team, never assert
// an unverified specific. The firewall trusts retrieval: it enforces "traces to
// context", not "is true" (a wrong-but-retrieved fact still passes; that residual
// is what the async semantic auditor + KB hygiene catch).

import { scrubContactEmails } from "./sanitize-email";

export type GroundingClass = "EMAIL" | "URL" | "PHONE" | "CURRENCY" | "PERCENT" | "DURATION" | "DATE" | "NUMBER";

export interface GroundingOptions {
  approvedEmail?: string;            // the business's real public inbox (rewrite target for invented company-domain emails)
  approvedPhones?: string[];         // approved contact phone(s) — always allowed
  enabled?: Partial<Record<GroundingClass, boolean>>;  // per-class override
  questionHint?: string;             // the customer's latest message — makes a deferral on-topic ("duration", not "fees")
  customerText?: string;             // everything the customer wrote — an address THEY gave may be echoed back
}

export interface GroundingAction {
  cls: GroundingClass;
  original: string;
  disposition: "rewrite" | "strip" | "defer";
  replacement?: string;
}

export interface GroundingResult { text: string; actions: GroundingAction[] }

// Default-ON: the classes whose disposition is clean (email rewrite / own-line URL
// strip) or whose fail-safe deferral protects the highest-value specifics for ANY
// business (price, duration, percentages, phone). Default-OFF: DATE and NUMBER —
// the most false-positive-prone ("today", "Monday", "top 3 reasons", "2 batches").
// Flip with GROUNDING_FIREWALL_STRICT=true or a per-class `enabled` override.
const STRICT = process.env.GROUNDING_FIREWALL_STRICT === "true";
const DEFAULT_ENABLED: Record<GroundingClass, boolean> = {
  EMAIL: true, URL: true, PHONE: true, CURRENCY: true, PERCENT: true, DURATION: true,
  DATE: STRICT, NUMBER: STRICT,
};

// ── Normalizers — fold equivalent surface forms to ONE canonical token so a
// correctly-grounded fact phrased differently still matches ("₹50,000"~"Rs 50000",
// "six months"~"6-month"~"6 months"). Over-folding causes false deferrals, so the
// normalizers stay deliberately tight. ──────────────────────────────────────────
const WORD_NUM: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};
function numToken(raw: string): string {
  const w = WORD_NUM[raw.toLowerCase()];
  let n = (w ?? raw).replace(/,/g, "").trim();
  if (/^\d+\.0+$/.test(n)) n = n.replace(/\.0+$/, "");   // 4.0 → 4
  return n;
}
const normEmail = (s: string) => s.trim().toLowerCase();
// Host + path, the comparable identity of a link: scheme, "www.", a trailing
// slash and trailing sentence punctuation dropped; the host lower-cased (paths
// are case-sensitive, so they are not).
function normUrl(s: string): { host: string; path: string } {
  const bare = s.replace(/[.,;:!?)\]]+$/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const cut = bare.search(/[/?#]/);
  const host = (cut < 0 ? bare : bare.slice(0, cut)).toLowerCase();
  const path = (cut < 0 ? "" : bare.slice(cut)).replace(/\/+$/, "");
  return { host, path };
}
// `host` is `domain` itself or one of its subdomains — never a lookalike that
// merely ends with the same letters ("evilanalytixlabs.co.in").
const onDomain = (host: string, domain: string) => !!domain && (host === domain || host.endsWith("." + domain));
const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);

// Digits from other scripts (Devanagari ४५,०००, Bengali, Tamil, Arabic-Indic,
// full-width…) read as ASCII before any extractor runs, so "₹४५,०००" is checked
// like "₹45,000" instead of slipping past every numeric rule.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];
export function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u09e6-\u09ef\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0be6-\u0bef\u0c66-\u0c6f\u0ce6-\u0cef\u0d66-\u0d6f\uff10-\uff19]/g, ch => {
    const c = ch.charCodeAt(0);
    const zero = DIGIT_ZEROS.find(z => c >= z && c <= z + 9)!;
    return String(c - zero);
  });
}

// A money amount as one canonical number of base units, so "₹1.5 lakh",
// "Rs 1,50,000" and "150000 rupees" are the same fact and "2 lakh" is not.
const MAGNITUDE: Record<string, number> = { k: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7 };
function moneyToken(raw: string): string {
  const m = raw.toLowerCase().match(/(\d[\d,]*(?:\.\d+)?)\s?(k|lakhs?|lacs?|crores?|cr)?\b/);
  if (!m) return numToken(raw.replace(/[^\d.,]/g, ""));
  const n = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2] ? MAGNITUDE[m[2]] ?? 1 : 1;
  return Number.isFinite(n) ? String(Math.round(n * mult * 100) / 100) : numToken(m[1]);
}

// ── Extractors. Each yields the matched surface strings; a class's allow-set is
// built by running the SAME extractor over the context, so reply tokens and
// context tokens are normalized identically. ────────────────────────────────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// The bare-domain branch carries a lookbehind so it never matches the domain
// PART of an email ("gmail.com" in "priya@gmail.com") — emails are handled by the
// EMAIL class, and a foreign email must survive the URL pass intact.
// The bare-domain branch knows the common generic TLDs plus any two-letter
// country code — the old list of eight let "pay-fees.xyz" or "bit.ly/x" through
// untouched. Two-letter suffixes that are far more often a language or file
// extension in prose ("Node.js", "main.py", "README.md") are excluded.
const GTLDS = "com|in|org|net|io|ai|edu|co|gov|info|biz|app|dev|me|xyz|online|site|top|club|shop|store|live|tech|link|click|page|gle|cloud|digital|academy|education|school|courses|today|world|pro|one|space|website|fun|icu|buzz|vip|work";
const NOT_TLD = "js|ts|py|md|rb|sh|go|cs|pl|db|rs|kt|hs|ex|vb|jl|mm|so|el|tf|ps";
const URL_RE = new RegExp(
  `https?:\\/\\/[^\\s)>"']+|www\\.[^\\s)>"']+|(?<![@\\w.])[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${GTLDS}|(?!(?:${NOT_TLD})\\b)[a-z]{2})(?:\\.[a-z]{2,})?\\b(?:\\/[^\\s)>"']*)?`,
  "gi",
);
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;                                   // ≥10 digits, phone-shaped
// A currency marker with an amount (optionally "lakh"/"crore"/"k"), OR an
// amount stated in lakh/crore with no marker at all ("the fee is 2.5 lakh") —
// the Indian way of quoting a fee, which the old pattern did not see.
const CURRENCY_RE = /(?:₹|\brs\.?|\binr|\busd|\bus\$|\$)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:lakhs?|lacs?|crores?|cr|k)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:lakhs?|lacs?|crores?)\b|\b\d[\d,]*(?:\.\d+)?\s?(?:rupees|inr|usd|dollars)\b/gi;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s?%/g;
const DURATION_RE = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s?(?:[-–to]+\s?(\d+(?:\.\d+)?))?[\s-]?(month|week|day|year|hour|hr|semester)s?\b/gi;
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

function matchAll(re: RegExp, s: string): string[] {
  return s ? (asciiDigits(s).match(new RegExp(re.source, re.flags)) ?? []) : [];
}

// Build the normalized set of grounded tokens for a class from the context string.
function groundedSet(cls: GroundingClass, context: string, opts: GroundingOptions): Set<string> {
  const set = new Set<string>();
  const add = (v: string) => v && set.add(v);
  switch (cls) {
    case "EMAIL": matchAll(EMAIL_RE, context).forEach(e => add(normEmail(e))); break;
    case "URL": matchAll(URL_RE, context).forEach(u => { const n = normUrl(u); add(n.host + n.path); }); break;
    case "PHONE":
      matchAll(PHONE_RE, context).forEach(p => add(last10(p)));
      (opts.approvedPhones ?? []).forEach(p => add(last10(p)));
      break;
    case "CURRENCY": matchAll(CURRENCY_RE, context).forEach(c => add(moneyToken(c))); break;
    case "PERCENT": matchAll(PERCENT_RE, context).forEach(p => add(numToken(p.replace(/[^\d.]/g, "")))); break;
    case "DURATION": durationTokens(context).forEach(add); break;
    case "DATE": matchAll(DATE_RE, context).forEach(d => add(d.toLowerCase().replace(/\s+/g, " "))); break;
    case "NUMBER": matchAll(NUMBER_RE, context).forEach(n => add(numToken(n))); break;
  }
  return set;
}

// A duration may be a range ("3.5–4 months" → 3.5 month + 4 month). Canonical form
// is "<num> <singular-unit>".
function durationTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of asciiDigits(s).matchAll(DURATION_RE)) {
    const unit = m[3].toLowerCase().replace(/s$/, "");
    out.push(`${numToken(m[1])} ${unit}`);
    if (m[2]) out.push(`${numToken(m[2])} ${unit}`);
  }
  return out;
}

// Sentence-level deferral copy, by the class that triggered it.
const DEFER_NOUN: Partial<Record<GroundingClass, string>> = {
  CURRENCY: "exact fees", PERCENT: "exact figures", DURATION: "exact duration and schedule",
  PHONE: "contact details", DATE: "exact dates", NUMBER: "exact numbers",
};
// What the CUSTOMER actually asked about — so a deferral reads on-topic regardless
// of which stray token tripped it. (A duration question where the model fabricated a
// fee must defer "the exact duration", never "the exact fees".) Null = no clear topic,
// fall back to the triggering class's noun.
function questionNoun(hint?: string): string | null {
  const h = (hint ?? "").toLowerCase();
  if (!h) return null;
  if (/\b(fee|fees|cost|costs|price|pricing|charge|charges|emi|tuition|payment|how much)\b/.test(h)) return "exact fees";
  if (/\b(duration|how long|months?|weeks?|years?|hours?|timeline|time it takes|schedule|timing|timings|availability|delivery time)\b/.test(h)) return "exact duration and schedule";
  if (/\b(date|dates|start date|starting|begins?|commence|next batch|batch date|delivery date|appointment date|check-?in)\b/.test(h)) return "exact dates";
  if (/\b(discount|scholarship|placement rate|percentage|percent|cashback|interest rate)\b/.test(h)) return "exact figures";
  if (/\b(call|phone|mobile|number|contact|whatsapp|email|reach)\b/.test(h)) return "contact details";
  return null;
}
// The abstention wording. It is only honest because every caller that sends a
// deferred reply also flags the chat for a person (llm.ts needsPerson) — a
// deferral that promised follow-up while nobody was told was a finding of the
// 2026-11 audit.
export function deferClause(cls: GroundingClass, preferredNoun?: string | null): string {
  return `I couldn't verify the ${preferredNoun ?? DEFER_NOUN[cls] ?? "exact details"} in the available knowledge base, so I've asked our team to confirm.`;
}

function isEnabled(cls: GroundingClass, opts: GroundingOptions): boolean {
  return opts.enabled?.[cls] ?? DEFAULT_ENABLED[cls];
}

// ── The firewall. Order: in-place token rewrites (EMAIL, URL) first, then
// sentence-level deferral for the numeric/contact-number classes. ───────────────
export function enforceGrounding(text: string, context: string, opts: GroundingOptions = {}): GroundingResult {
  const actions: GroundingAction[] = [];
  // Operational kill-switch — disables ALL grounding classes at once (the persona
  // scrub in sanitizeOutbound still runs). For rolling back fast if a normalizer
  // ever over-defers in production, without a redeploy.
  if (!text || process.env.GROUNDING_FIREWALL === "false") return { text, actions };
  let out = text;

  // EMAIL — kept when it traces to the context, is the approved inbox, or is an
  // address the CUSTOMER wrote (echoing their own email back). An invented
  // address on the company domain is rewritten to the approved inbox; any other
  // invented address is removed — "write to fees@pay-support.example" is
  // exactly the fabricated contact the firewall exists to stop.
  if (isEnabled("EMAIL", opts)) {
    const grounded = groundedSet("EMAIL", context, opts);
    const approved = (opts.approvedEmail ?? "").trim().toLowerCase();
    const theirs = new Set(matchAll(EMAIL_RE, opts.customerText ?? "").map(normEmail));
    out = out.replace(EMAIL_RE, m => {
      const n = normEmail(m);
      if (grounded.has(n) || theirs.has(n) || (approved && n === approved)) return m;
      if (approved) {
        const rewritten = scrubContactEmails(m, approved);            // company-domain → approved
        if (rewritten !== m) { actions.push({ cls: "EMAIL", original: m, disposition: "rewrite", replacement: rewritten }); return rewritten; }
      }
      actions.push({ cls: "EMAIL", original: m, disposition: "strip" });
      return "";
    });
  }

  // URL — a link is kept only when it traces to the context: the same page
  // (host + path), a parent page of one, or the bare host of one — or when it is
  // on the approved domain itself or a subdomain of it. Matching by host alone
  // let ANY path through on a host the context mentions once ("forms.gle/…",
  // "bit.ly/…", a shared drive). The prompt puts links on their own line, so
  // removal is low-impact.
  if (isEnabled("URL", opts)) {
    const grounded = groundedSet("URL", context, opts);
    const approvedDomain = opts.approvedEmail ? opts.approvedEmail.split("@")[1]?.toLowerCase() ?? "" : "";
    const traces = (host: string, path: string) => {
      for (const g of grounded) {
        const slash = g.indexOf("/");
        const gHost = slash < 0 ? g : g.slice(0, slash);
        const gPath = slash < 0 ? "" : g.slice(slash);
        if (gHost !== host) continue;
        if (!path || path === gPath || gPath.startsWith(path + "/")) return true;
      }
      return false;
    };
    out = out.replace(URL_RE, m => {
      const { host, path } = normUrl(m);
      if (traces(host, path) || onDomain(host, approvedDomain)) return m;
      actions.push({ cls: "URL", original: m, disposition: "strip" });
      return "";
    });
  }

  // Numeric / contact-number classes — an ungrounded token can't be safely excised
  // mid-sentence without mangling, so we replace the whole SENTENCE containing it
  // with a fail-safe deferral. Replies are short (1–2 lines), so a deferred
  // sentence is a clean, honest hand-off rather than a fabricated specific.
  const sentenceClasses: GroundingClass[] = (["CURRENCY", "DURATION", "PERCENT", "PHONE", "DATE", "NUMBER"] as GroundingClass[])
    .filter(c => isEnabled(c, opts));
  if (sentenceClasses.length) {
    const grounded: Partial<Record<GroundingClass, Set<string>>> = {};
    for (const c of sentenceClasses) grounded[c] = groundedSet(c, context, opts);
    const preferredNoun = questionNoun(opts.questionHint);

    // Keep every grounded sentence in order; drop each sentence that asserts an
    // ungrounded specific. The grounded answer therefore ALWAYS leads, and a single
    // on-topic deferral (never several) trails it — so a stray fabricated fee can no
    // longer push an irrelevant "For the exact fees…" to the front of the reply.
    const sentences = out.split(/(?<=[.!?।])\s+/);
    const kept: string[] = [];
    let deferralClause = "";
    for (const sentence of sentences) {
      let deferred = false;
      for (const cls of sentenceClasses) {
        const g = grounded[cls]!;
        const ungrounded = classTokens(cls, sentence).find(t => !g.has(t.norm));
        if (ungrounded) {
          actions.push({ cls, original: ungrounded.raw, disposition: "defer" });
          deferralClause = deferClause(cls, preferredNoun);   // last one wins; on-topic noun preferred
          deferred = true;
          break;
        }
      }
      if (!deferred && sentence.trim()) kept.push(sentence);
    }
    const pieces = [...kept];
    if (deferralClause) pieces.push(deferralClause);
    out = pieces.join(" ");
  }

  out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\s+([,.!?])/g, "$1").trim();
  return { text: out, actions };
}

// Tokens of a class within a string, paired with their normalized form.
function classTokens(cls: GroundingClass, s: string): { raw: string; norm: string }[] {
  switch (cls) {
    case "CURRENCY": return matchAll(CURRENCY_RE, s).map(c => ({ raw: c, norm: moneyToken(c) }));
    case "PERCENT": return matchAll(PERCENT_RE, s).map(p => ({ raw: p, norm: numToken(p.replace(/[^\d.]/g, "")) }));
    case "PHONE": return matchAll(PHONE_RE, s).map(p => ({ raw: p, norm: last10(p) }));
    case "DATE": return matchAll(DATE_RE, s).map(d => ({ raw: d, norm: d.toLowerCase().replace(/\s+/g, " ") }));
    case "NUMBER": return matchAll(NUMBER_RE, s).map(n => ({ raw: n, norm: numToken(n) }));
    case "DURATION": {
      const out: { raw: string; norm: string }[] = [];
      for (const m of asciiDigits(s).matchAll(DURATION_RE)) {
        const unit = m[3].toLowerCase().replace(/s$/, "");
        out.push({ raw: m[0], norm: `${numToken(m[1])} ${unit}` });
        if (m[2]) out.push({ raw: m[0], norm: `${numToken(m[2])} ${unit}` });
      }
      return out;
    }
    default: return [];
  }
}
