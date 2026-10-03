// Stage 3 — the writer, and stage 4's model half.
//
// Brand voice is taught by example rather than description. "Write in a direct,
// specific tone" produces the same article every model produces; three of our
// actual posts in the prompt produce something that sounds like the site.

import Anthropic from "@anthropic-ai/sdk";
import type { Draft, Issue } from "./review.ts";

const MODEL = process.env.CONTENT_MODEL || "claude-sonnet-5";

const SYSTEM = `You write for the Talko AI blog. Talko AI is a customer conversation
platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business
Profile reviews and website chat, built for small and medium businesses, mostly in India.

HOW THIS BLOG WRITES — these are rules, not preferences:
- Open with the concrete situation a reader is actually in, then a "bottom line"
  paragraph that answers the question before they scroll.
- Specific over general, always. Real figures, real limits, real mechanisms.
- Never invent a number, a date, a limit or a policy. If you are not certain of a
  figure, describe the mechanism and leave the figure out. A wrong number here is
  worse than no article.
- Say the uncomfortable thing. If a feature has a downside, or the honest answer is
  "this barely matters", write that. The reader can tell when they are being sold to.
- No filler: no "in today's fast-paced", no "game-changer", no "in conclusion".
- British-leaning spelling, plain words, short sentences where they fit.
- Indian context where relevant: ₹ pricing, DPDP, Indian SMB examples.

OUTPUT: a single JSON object, no markdown fence, matching:
{ "slug": "kebab-case", "title": "...", "excerpt": "80-300 chars",
  "category": "Playbook" | "Growth" | "Compliance" | "Product",
  "readTime": "N min read",
  "body": [ {"type":"p","text":"..."}, {"type":"h2","text":"..."},
            {"type":"list","items":["..."]},
            {"type":"callout","tone":"warn"|"info","title":"...","text":"..."} ],
  "faqs": [ {"q":"...","a":"..."} ],
  "sources": [ {"label":"...","href":"https://...","note":"..."} ] }

Internal links use [label](/path) inside any text. Link 2+ of: /features, /pricing,
/blog, /guides, /industries.`;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — the pipeline cannot draft without it.");
  return new Anthropic({ apiKey });
}

function parseDraft(raw: string): Draft {
  const json = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`Model did not return JSON: ${raw.slice(0, 200)}`);
  return JSON.parse(json.slice(start, end + 1)) as Draft;
}

async function ask(messages: Anthropic.MessageParam[]): Promise<string> {
  const res = await client().messages.create({
    model: MODEL, max_tokens: 8000, system: SYSTEM, messages,
  });
  return res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("");
}

export async function draftPost(topic: { label: string; covered: string[]; examples: string[] }, voiceSamples: string): Promise<Draft> {
  const prompt = `Write a new article on this topic.

TOPIC: ${topic.label}
Competitors already covering it: ${topic.covered.join(", ")} — so the topic has
demand, and a near-copy of their angle is worthless. Find the angle they miss:
the caveat, the thing that is actually true, the part that costs money to get wrong.

Here are three of our own posts, so you can hear the voice:
${voiceSamples}

Return only the JSON object.`;
  return parseDraft(await ask([{ role: "user", content: prompt }]));
}

/** Hand the editor's findings back to the writer. Same voice, targeted fixes. */
export async function reviseDraft(draft: Draft, issues: Issue[]): Promise<Draft> {
  const prompt = `This draft failed review. Fix ONLY these issues and return the full
corrected JSON object. Do not rewrite what was not flagged.

ISSUES:
${issues.map(i => `- [${i.rule}] ${i.detail}`).join("\n")}

DRAFT:
${JSON.stringify(draft)}`;
  return parseDraft(await ask([{ role: "user", content: prompt }]));
}

/**
 * The one check code cannot make: is any specific claim unsupported?
 * Deliberately narrow. A model asked for a general opinion will invent work.
 */
export async function factCheck(draft: Draft): Promise<Issue[]> {
  const text = draft.body.flatMap(b => [b.text ?? "", ...(b.items ?? [])]).join("\n");
  const prompt = `Below is a draft article and its source list. List ONLY factual claims
that are specific (a number, a date, a limit, a named policy) AND not supported by the
listed sources or by stable public knowledge. Ignore style, structure and opinion.

Reply with a JSON array of {"rule":"fact","detail":"..."} — an empty array [] if none.

SOURCES: ${JSON.stringify(draft.sources ?? [])}
DRAFT:
${text}`;
  const raw = await ask([{ role: "user", content: prompt }]);
  try {
    const s = raw.indexOf("["), e = raw.lastIndexOf("]");
    return s < 0 ? [] : (JSON.parse(raw.slice(s, e + 1)) as Issue[]);
  } catch { return []; }
}
