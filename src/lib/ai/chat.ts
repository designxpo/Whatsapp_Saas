// Multi-provider chat gateway. Each tenant brings their OWN chat API key
// (Gemini / OpenAI / Anthropic) — see `keys.ts` for resolution. Embeddings are
// NOT here: they stay on the platform Gemini key (`kb.ts`) so the shared
// vector(768) space stays consistent across tenants.
//
// `runChat` performs ONE generation round and returns a normalized result. The
// tool-calling loop lives in `llm.ts` and is provider-agnostic: it appends the
// assistant's tool calls + the tool results to `turns` and calls `runChat` again.

import { GoogleGenAI, Type, type Content } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type AiProvider = "gemini" | "openai" | "anthropic";

// Default chat model per provider when the tenant hasn't pinned one.
export const DEFAULT_CHAT_MODEL: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-opus-4-8",
};

// A single tool the model may call (mirrors an AI Hub function).
export interface ChatTool {
  name: string;
  description: string;
  // Flat string params (matches Ai Hub functions); required names listed.
  params: { name: string; description: string }[];
  required: string[];
}

// Normalized conversation turns — rebuilt into each provider's wire format on
// every call (stateless), so the loop never threads provider objects around.
export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "assistant"; calls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ToolResult { id: string; name: string; status: string }

export interface RunChatOpts {
  provider: AiProvider;
  apiKey: string;
  model: string;
  system: string;
  turns: ChatTurn[];
  tools?: ChatTool[];
  maxTokens?: number;
}

export interface ChatResult {
  text: string;          // assistant text ("" when it only called tools)
  toolCalls: ToolCall[]; // empty when the model produced a final answer
}

// ── client caches (per apiKey) ───────────────────────────────────────────────
const geminiClients = new Map<string, GoogleGenAI>();
const openaiClients = new Map<string, OpenAI>();
const anthropicClients = new Map<string, Anthropic>();

function gemini(apiKey: string): GoogleGenAI {
  let c = geminiClients.get(apiKey);
  if (!c) { c = new GoogleGenAI({ apiKey }); geminiClients.set(apiKey, c); }
  return c;
}
function openaiClient(apiKey: string): OpenAI {
  let c = openaiClients.get(apiKey);
  if (!c) { c = new OpenAI({ apiKey }); openaiClients.set(apiKey, c); }
  return c;
}
function anthropic(apiKey: string): Anthropic {
  let c = anthropicClients.get(apiKey);
  if (!c) { c = new Anthropic({ apiKey }); anthropicClients.set(apiKey, c); }
  return c;
}

// ── dispatcher ────────────────────────────────────────────────────────────────
export async function runChat(opts: RunChatOpts): Promise<ChatResult> {
  switch (opts.provider) {
    case "gemini": return runGemini(opts);
    case "openai": return runOpenAI(opts);
    case "anthropic": return runAnthropic(opts);
  }
}

// ── Gemini ─────────────────────────────────────────────────────────────────────
function runGemini(opts: RunChatOpts): Promise<ChatResult> {
  const contents: Content[] = opts.turns.map((t): Content => {
    if (t.role === "user") return { role: "user", parts: [{ text: t.text }] };
    if (t.role === "tool") return { role: "user", parts: t.results.map(r => ({ functionResponse: { name: r.name, response: { status: r.status } } })) };
    if ("calls" in t) return { role: "model", parts: t.calls.map(c => ({ functionCall: { name: c.name, args: c.args } })) };
    return { role: "model", parts: [{ text: t.text }] };
  });
  const tools = opts.tools?.length
    ? [{ functionDeclarations: opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: Type.OBJECT,
          properties: Object.fromEntries(t.params.map(p => [p.name, { type: Type.STRING, description: p.description }])),
          required: t.required,
        },
      })) }]
    : undefined;
  return gemini(opts.apiKey).models.generateContent({
    model: opts.model,
    contents,
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens ?? 1024,
      thinkingConfig: { thinkingBudget: 0 }, // chat replies don't need extended reasoning
      ...(tools ? { tools } : {}),
    },
  }).then(res => ({
    text: (res.text ?? "").trim(),
    toolCalls: (res.functionCalls ?? []).map((c, i) => ({
      id: `gem_${i}`, name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown>,
    })),
  }));
}

// ── OpenAI (Chat Completions) ───────────────────────────────────────────────────
async function runOpenAI(opts: RunChatOpts): Promise<ChatResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: opts.system }];
  for (const t of opts.turns) {
    if (t.role === "user") messages.push({ role: "user", content: t.text });
    else if (t.role === "tool") for (const r of t.results) messages.push({ role: "tool", tool_call_id: r.id, content: r.status });
    else if ("calls" in t) messages.push({
      role: "assistant", content: null,
      tool_calls: t.calls.map(c => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    });
    else messages.push({ role: "assistant", content: t.text });
  }
  const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = opts.tools?.length
    ? opts.tools.map(t => ({
        type: "function",
        function: {
          name: t.name, description: t.description,
          parameters: {
            type: "object",
            properties: Object.fromEntries(t.params.map(p => [p.name, { type: "string", description: p.description }])),
            required: t.required,
          },
        },
      }))
    : undefined;
  const res = await openaiClient(opts.apiKey).chat.completions.create({
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    ...(tools ? { tools } : {}),
  });
  const msg = res.choices[0]?.message;
  return {
    text: (msg?.content ?? "").trim(),
    toolCalls: (msg?.tool_calls ?? []).flatMap(tc => {
      if (tc.type !== "function") return [];
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep {} */ }
      return [{ id: tc.id, name: tc.function.name, args }];
    }),
  };
}

// ── Anthropic (Messages API) ─────────────────────────────────────────────────────
async function runAnthropic(opts: RunChatOpts): Promise<ChatResult> {
  const messages: Anthropic.MessageParam[] = [];
  for (const t of opts.turns) {
    if (t.role === "user") messages.push({ role: "user", content: t.text });
    else if (t.role === "tool") messages.push({
      role: "user",
      content: t.results.map(r => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.status })),
    });
    else if ("calls" in t) messages.push({
      role: "assistant",
      content: t.calls.map(c => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.args })),
    });
    else messages.push({ role: "assistant", content: t.text });
  }
  const tools: Anthropic.Tool[] | undefined = opts.tools?.length
    ? opts.tools.map(t => ({
        name: t.name, description: t.description,
        input_schema: {
          type: "object" as const,
          properties: Object.fromEntries(t.params.map(p => [p.name, { type: "string", description: p.description }])),
          required: t.required,
        },
      }))
    : undefined;
  const res = await anthropic(opts.apiKey).messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages,
    ...(tools ? { tools } : {}),
  });
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of res.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> });
  }
  return { text: text.trim(), toolCalls };
}

// Lightweight validation call used when a tenant saves a key.
export async function validateKey(provider: AiProvider, apiKey: string, model: string): Promise<void> {
  await runChat({ provider, apiKey, model, system: "You are a connectivity check.", turns: [{ role: "user", text: "Reply with the single word: ok" }], maxTokens: 16 });
}
