// Customer behaviour read — a ZERO-COST (no model call, no latency) heuristic that
// classifies the customer's latest message by sentiment, buying-journey stage, and
// urgency. The result is rendered into a short "Customer read" block injected into
// the system prompt so the assistant ADAPTS its tone and next step — educate a
// browser, be concrete for a high-intent lead, empathise with a frustrated one,
// handle an objection with value. The model still does the nuanced reading; this
// just makes the strategy reliable and consistent across channels.

export type Sentiment = "frustrated" | "positive" | "neutral";
export type Stage = "greeting" | "browsing" | "evaluating" | "high_intent" | "objection" | "support" | "neutral";

export interface BehaviorRead {
  sentiment: Sentiment;
  stage: Stage;
  urgent: boolean;
}

const GREETING_RE = /^\s*(?:hi+|hey+|hello+|helo+|hiya|yo+|hola|namaste|namaskar|salaam|good\s*(?:morning|afternoon|evening|day)|gm|greetings)[\s!.,]*$/i;

const FRUSTRATED_RE = /\b(angry|annoyed|frustrat\w*|useless|worst|terrible|horrible|pathetic|nonsense|rubbish|wast\w*|scam|fraud|cheat\w*|ridiculous|disappoint\w*|fed up|sick of|not happy|unhappy|poor service|third time|again and again|still (?:not|no|haven'?t|waiting))\b/i;
const POSITIVE_RE = /(\b(thanks|thank you|thx|great|awesome|excellent|amazing|wonderful|love it|sounds good|cool|nice|appreciate|helpful|perfect)\b|👍|🙏|😊|❤️|🔥)/i;

const SUPPORT_RE = /\b(my (?:account|login|payment|enrol?ment|batch|class|order)|can'?t (?:login|log\s?in|access)|not (?:received|working|able to)|refund|reschedul\w*|missed (?:my|the) (?:class|session)|recording|certificate not|didn'?t (?:get|receive)|issue with|problem with|complaint)\b/i;
const HIGH_INTENT_RE = /\b(enroll?|enrol(?:ment|ling)?|admission|admit|join(?:ing)?|register|registration|sign\s?up|pay(?:ment)?|emi|instal?ment|book(?:ing)?|reserve|start (?:the )?course|how (?:do|to) (?:i )?(?:apply|join|enroll?|register)|i want to (?:join|enroll?|register|start|buy)|ready to (?:join|start|pay)|call\s?back|schedule a call|free demo|book a demo)\b/i;
const OBJECTION_RE = /\b(too (?:expensive|costly|much)|expensive|costly|can'?t afford|out of budget|cheaper|lower price|why should i|not sure|think about it|maybe later|i'?ll (?:get back|think)|need (?:some )?time|no time|not interested)\b/i;
const EVALUATING_RE = /\b(compare|comparison|vs\.?|versus|difference between|which (?:course|program|one|is better)|better|best (?:course|option|for)|worth it|syllabus|curriculum|placement|salary|package|certificate|certification|eligib\w*|duration|how long|reviews?|ratings?|outcomes?|job (?:guarantee|assistance|support)|after (?:the )?course)\b/i;
const BROWSING_RE = /\b(what (?:is|are|do)|tell me (?:about|more)|do you (?:have|offer|provide)|information|details about|explain|about (?:your|the|this) (?:course|program|institute|company)|who are you|courses?\b|programs?\b)\b/i;

const URGENT_RE = /\b(urgent\w*|asap|immediately|right now|today|last date|deadline|closing soon|few seats|seats? left|hurry|quickly)\b/i;

function detectStage(text: string): Stage {
  if (GREETING_RE.test(text)) return "greeting";
  if (SUPPORT_RE.test(text)) return "support";
  if (HIGH_INTENT_RE.test(text)) return "high_intent";
  if (OBJECTION_RE.test(text)) return "objection";
  if (EVALUATING_RE.test(text)) return "evaluating";
  if (BROWSING_RE.test(text)) return "browsing";
  return "neutral";
}

function detectSentiment(text: string): Sentiment {
  if (FRUSTRATED_RE.test(text)) return "frustrated";
  if (POSITIVE_RE.test(text)) return "positive";
  return "neutral";
}

// Read behaviour from the conversation. We classify the customer's LATEST message
// (that's where their current intent lives); the model still has full history.
export function readBehavior(history: { role: "user" | "assistant"; body: string }[]): BehaviorRead {
  const last = [...history].reverse().find(m => m.role === "user")?.body?.trim() ?? "";
  return { sentiment: detectSentiment(last), stage: detectStage(last), urgent: URGENT_RE.test(last) };
}

const STAGE_GUIDANCE: Record<Stage, string> = {
  greeting: "They're just opening the conversation — greet warmly, say who we are in one line, and ask how you can help.",
  browsing: "They're exploring / gathering info — educate concisely and invite a specific question; don't hard-sell yet.",
  evaluating: "They're comparing options / weighing fit — give concrete specifics (fees, duration, placements, syllabus) from the business context, compare honestly, and highlight what suits them. Offer a counsellor for a tailored plan.",
  high_intent: "They're ready to act — be concrete and action-oriented: give the exact next step to enrol/book, share the relevant link, and offer a counsellor callback. Don't bury the lead under extra information.",
  objection: "They have a hesitation (price / timing / doubt) — acknowledge it, address it with value (EMI options, outcomes, placements, flexible batches), and reassure without pressure.",
  support: "This looks like an existing-customer issue — acknowledge it, help from the business context if you can, and offer to connect a human if it needs account access you don't have.",
  neutral: "",
};

// Render the read into a system-prompt block. Empty when there's nothing useful to
// add (so a plain neutral message doesn't bloat the prompt).
export function behaviorBlock(read: BehaviorRead): string {
  const lines: string[] = [];
  if (read.sentiment === "frustrated") lines.push("They sound frustrated or unhappy — lead with empathy, acknowledge the issue, keep it short and concrete, and proactively offer to connect a human.");
  else if (read.sentiment === "positive") lines.push("They sound positive — match their warmth and keep the momentum going.");
  const stage = STAGE_GUIDANCE[read.stage];
  if (stage) lines.push(stage);
  if (read.urgent) lines.push("There's urgency in their message — respond promptly with the key info and a fast next step.");
  if (!lines.length) return "";
  return ["--- Customer read (adapt to this; never mention or label it) ---", ...lines].join("\n");
}
