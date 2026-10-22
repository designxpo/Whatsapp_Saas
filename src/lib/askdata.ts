// "Ask your data" — a workspace admin types a question about their business,
// gets an answer in a sentence or two.
//
// The model only ever chooses among the read-only tools in askdata-tools.ts
// and fills in their arguments; it never sees or writes a query. Its answer is
// returned with every count it used ("How I counted"), so a reader can check
// the number rather than trust it.
//
// Runs on the workspace's own AI provider and key (ai/keys.ts — BYO), so it
// works the same on Gemini, OpenAI or Anthropic, and throws AiKeyMissingError
// when the workspace has not set one up.

import { runChat, type ChatTurn, type ToolResult as ChatToolResult } from "./ai/chat";
import { resolveTenantAi } from "./ai/keys";
import { ASK_TOOLS, runTool } from "./askdata-tools";
import { partsIn } from "./businessclock";

const MAX_ROUNDS = 5;
const MAX_QUESTION = 500;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface AskResult { answer: string; steps: { tool: string; description: string }[] }

function systemPrompt(now: number): string {
  const w = partsIn(new Date(now));
  const today = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
  return [
    "You answer questions about one business's WhatsApp, Instagram, Messenger and website-chat operations, using ONLY the tools provided.",
    `Today is ${weekday} ${today} in the business's timezone. Dates are YYYY-MM-DD, and both ends of a range are included.`,
    "\"Yesterday\" is the day before today. \"Last week\" is the 7 days ending yesterday. \"This month\" is the 1st of this month to today.",
    "Every number in your answer must come from a tool result. Never estimate, extrapolate or invent one.",
    "If the tools cannot answer the question, say so plainly and say what you can count instead.",
    "When the question names a number or account you have not seen, call list_numbers to get its exact name.",
    "Answer in one to three short sentences with the figures. No tables, no markdown.",
  ].join("\n");
}

export async function askData(question: string, tenantId: string, now = Date.now()): Promise<AskResult> {
  const q = (question ?? "").trim();
  if (!q) throw new Error("Ask a question first.");
  if (q.length > MAX_QUESTION) throw new Error(`Keep the question under ${MAX_QUESTION} characters.`);

  const ai = await resolveTenantAi(tenantId);
  const steps: AskResult["steps"] = [];
  const turns: ChatTurn[] = [{ role: "user", text: q }];
  const system = systemPrompt(now);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await runChat({ provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system, turns, tools: ASK_TOOLS, maxTokens: 1024 });
    if (!res.toolCalls.length) {
      const answer = (res.text ?? "").trim();
      return { answer: answer || "I couldn't work that out — try asking it a different way.", steps };
    }
    turns.push({ role: "assistant", calls: res.toolCalls });
    const results: ChatToolResult[] = [];
    for (const c of res.toolCalls) {
      const r = await runTool(c.name, c.args ?? {}, tenantId);
      steps.push({ tool: c.name, description: r.ok ? r.description : `Could not count: ${r.error}` });
      results.push({ id: c.id, name: c.name, status: JSON.stringify(r.ok ? r.result : { error: r.error }) });
    }
    turns.push({ role: "tool", results });
  }
  return { answer: "That needed more counting than I do for one question — try narrowing it down.", steps };
}
