// Multi-provider chat gateway. Each tenant brings their OWN chat API key
// (Gemini / OpenAI / Anthropic) — see `keys.ts` for resolution. Embeddings are
// NOT here: they stay on the platform Gemini key (`kb.ts`) so the shared
// vector(768) space stays consistent across tenants.
//
// `runChat` performs ONE generation round and returns a normalized result. The
// tool-calling loop lives in `llm.ts` and is provider-agnostic: it appends the
// assistant's tool calls + the tool results to `turns` and calls `runChat` again.

import { GoogleGenAI, Type, type Content, type Part } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type AiProvider = "gemini" | "openai" | "anthropic";

// Which inline media each provider can natively SEE in a chat turn. Images: all
// three. PDFs: Gemini + Anthropic (OpenAI Chat Completions takes images only).
// Video: Gemini only. Used by the reply pipeline to pick what's worth attaching.
export function providerSupportsMedia(provider: AiProvider, mimeType: string): boolean {
  const m = (mimeType || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  if (m === "application/pdf") return provider === "gemini" || provider === "anthropic";
  if (m.startsWith("video/")) return provider === "gemini";
  return false;
}

// Default chat model per provider when the tenant hasn't pinned one.
export const DEFAULT_CHAT_MODEL: Record<AiProvider, string> = {
  gemini: "gemini-3.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-opus-4-8",
};

// How hard a Gemini chat reply may THINK. -1 = dynamic: it reasons only as much as
// the message needs (~0 on a greeting, deeper on a course comparison). 0 disables
// thinking (fastest, least intelligent — the old behaviour). Gemini 3.5 Flash
// thinks fast, so dynamic is the best intelligence/latency balance. Set
// GEMINI_CHAT_THINKING_BUDGET=0 to revert, or a positive integer to cap it.
const GEMINI_THINKING_BUDGET = Number(process.env.GEMINI_CHAT_THINKING_BUDGET ?? "-1");

// A single tool the model may call (mirrors an AI Hub function).
export interface ChatTool {
  name: string;
  description: string;
  // Flat string params (matches Ai Hub functions); required names listed.
  params: { name: string; description: string }[];
  required: string[];
}

// Inline media a user turn carries so the model can SEE it (base64-encoded bytes
// + MIME). Pre-filtered to what the chosen provider supports before it gets here.
export interface ChatMedia { mimeType: string; data: string }

// Normalized conversation turns — rebuilt into each provider's wire format on
// every call (stateless), so the loop never threads provider objects around.
export type ChatTurn =
  | { role: "user"; text: string; media?: ChatMedia[] }
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
  timeoutMs?: number;   // per-attempt cap; raise it for heavy media (e.g. video)
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

// ── resilience ────────────────────────────────────────────────────────────────
// Provider endpoints intermittently return 503/429 "overloaded / high demand"
// (Gemini's shared tier especially) and their SDKs can retry with no cap — which
// makes a brief/reply spin forever in the UI. Wrap every call so it: retries
// transient failures with short backoff, but hard-caps each attempt so it can
// NEVER hang. Real errors (bad key, 400) surface as-is; persistent overloads /
// timeouts become AI_BUSY, which callers turn into a clear "try again" message.
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const TRANSIENT = /\b(429|500|502|503|529)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|rate.?limit|deadline|timed out|timeout|AI_TIMEOUT|fetch failed|ECONNRESET|ETIMEDOUT/i;

async function runResilient(fn: () => Promise<ChatResult>, tries = 4, perTryMs = 24000): Promise<ChatResult> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const p = fn();
      p.catch(() => {}); // swallow if it loses the timeout race (avoids unhandled rejection)
      return await Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("AI_TIMEOUT")), perTryMs)),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT.test(msg)) throw err;          // real error (bad key, 400) — surface as-is
      if (attempt === tries - 1) break;             // transient but out of tries
      await sleep(500 * (attempt + 1));             // 0.5s, 1s, 1.5s backoff
    }
  }
  throw new Error("AI_BUSY"); // exhausted transient retries / timed out
}

// ── dispatcher ────────────────────────────────────────────────────────────────
export async function runChat(opts: RunChatOpts): Promise<ChatResult> {
  return runResilient(() => {
    switch (opts.provider) {
      case "gemini": return runGemini(opts);
      case "openai": return runOpenAI(opts);
      case "anthropic": return runAnthropic(opts);
    }
  }, 4, opts.timeoutMs ?? 24000);
}

// ── Gemini ─────────────────────────────────────────────────────────────────────
function runGemini(opts: RunChatOpts): Promise<ChatResult> {
  const contents: Content[] = opts.turns.map((t): Content => {
    if (t.role === "user") {
      const parts: Part[] = [];
      for (const md of t.media ?? []) parts.push({ inlineData: { mimeType: md.mimeType, data: md.data } });
      if (t.text || parts.length === 0) parts.push({ text: t.text });
      return { role: "user", parts };
    }
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
      // Dynamic thinking by default — the model reasons only when the message needs
      // it. Tunable via GEMINI_CHAT_THINKING_BUDGET (0 = off, for lowest latency).
      thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
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
    if (t.role === "user") {
      if (t.media?.length) {
        const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
        if (t.text) content.push({ type: "text", text: t.text });
        for (const md of t.media) if (md.mimeType.startsWith("image/")) content.push({ type: "image_url", image_url: { url: `data:${md.mimeType};base64,${md.data}` } });
        messages.push({ role: "user", content: content.length ? content : t.text });
      } else messages.push({ role: "user", content: t.text });
    }
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
    toolCalls: (msg?.tool_calls ?? []).flatMap((tc, i) => {
      if (tc.type !== "function") return [];
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep {} */ }
      // Synthesize a stable id if the provider omits one, so the assistant
      // tool_calls[].id and the follow-up tool_result id always agree (the
      // OpenAI API rejects a tool_call_id mismatch with a 400). Mirrors Gemini.
      return [{ id: tc.id || `oai_${i}`, name: tc.function.name, args }];
    }),
  };
}

// ── Anthropic (Messages API) ─────────────────────────────────────────────────────
async function runAnthropic(opts: RunChatOpts): Promise<ChatResult> {
  const messages: Anthropic.MessageParam[] = [];
  for (const t of opts.turns) {
    if (t.role === "user") {
      if (t.media?.length) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (t.text) blocks.push({ type: "text", text: t.text });
        for (const md of t.media) {
          if (md.mimeType.startsWith("image/")) blocks.push({ type: "image", source: { type: "base64", media_type: md.mimeType as Anthropic.Base64ImageSource["media_type"], data: md.data } });
          else if (md.mimeType === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: md.data } });
        }
        messages.push({ role: "user", content: blocks.length ? blocks : t.text });
      } else messages.push({ role: "user", content: t.text });
    }
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
