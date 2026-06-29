// ── sanitizeOutbound — the single chokepoint every AI-generated outbound text
// passes through before it reaches a customer, on EVERY channel. It composes the
// deterministic guards into one call so "a reply never leaks a persona name and
// never states an ungrounded specific" is a STRUCTURAL invariant, not a property
// of one return statement:
//
//   1. stripLeadingName / scrubSelfIntro — the bot has no personal name.
//   2. GroundingFirewall (enforceGrounding) — contact details, prices, durations,
//      etc. must trace to the retrieved context or the approved contact config.
//
// Brand signals are PARAMS, never hardcoded here: the internal app passes its env
// default, the multi-tenant SaaS passes per-tenant config. Returns the cleaned
// text plus the list of actions taken (for telemetry / KB-gap signals).

import { enforceGrounding, type GroundingOptions, type GroundingAction } from "./grounding";

export { scrubContactEmails, PUBLIC_CONTACT_EMAIL } from "./sanitize-email";
export type { GroundingAction, GroundingClass, GroundingOptions } from "./grounding";

// Strip a leading persona/name label the model sometimes prepends despite the
// system prompt — e.g. "Maya:", "*Maya*:", "MAYA SUPPORT:", "MAYA CUSTOMER
// SUPPORT:", "**MAYA SUPPORT:**", "SUPPORT:". Two passes:
//   1) a ROLE label — any (0–2 word) name followed by a role word (support/
//      sales/team…), in any case, with the colon optionally wrapped in bold and
//      no whitespace required after it ("MAYA SUPPORT:The…"). This is what leaked
//      in production: "**MAYA SUPPORT:**" slipped past the old name-only regex
//      because the bold "**" sat between the colon and the space.
//   2) a 1–2 TitleCase-word personal name ("Maya:", "Riya:"), kept when it's a
//      common content opener ("Note:", "Fees:", "Total:", "Contact:") so real
//      content survives.
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

export interface SanitizeContext extends GroundingOptions {
  agentName?: string | null;
  context?: string;          // the retrieved Business context this reply is allowed to draw specifics from
}

export interface SanitizeResult { text: string; actions: GroundingAction[] }

// The composed guard. `context` is the allow-set source: retrieved RAG chunks for
// an LLM answer, or the original factual answer for a persona-toned FAQ/cache hit.
export function sanitizeOutbound(text: string, ctx: SanitizeContext = {}): SanitizeResult {
  const named = stripLeadingName(text ?? "", ctx.agentName ?? null);
  const grounded = enforceGrounding(named, ctx.context ?? "", ctx);
  return { text: grounded.text, actions: grounded.actions };
}
