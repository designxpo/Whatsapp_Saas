import { describe, it, expect, vi, beforeEach } from "vitest";

// The chat gateway's token contract. Gemini bills THINKING tokens against
// `maxOutputTokens`, so the reasoning a model does before it writes came out of
// the same budget as the answer. A caller asking for 160 answer tokens got most
// of them spent thinking and the leftover shipped mid-word — that is how an AI
// follow-up reached a customer as "Maa Kali ke mand".
//
// The contract these tests lock in:
//   1. `maxTokens` means room for the ANSWER on every provider — Gemini gets a
//      separate reserve for thinking on top of it.
//   2. A generation that stopped at the ceiling is reported as `truncated`, so no
//      caller can silently send a fragment.
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class { models = { generateContent }; },
  Type: { OBJECT: "OBJECT", STRING: "STRING" },
  FinishReason: { STOP: "STOP", MAX_TOKENS: "MAX_TOKENS" },
}));

import { runChat } from "../ai/chat";

const call = (maxTokens?: number) => runChat({
  provider: "gemini", apiKey: "k", model: "gemini-test", system: "s",
  turns: [{ role: "user", text: "hi" }], maxTokens,
});
const configOf = () => (generateContent.mock.calls[0][0] as { config: { maxOutputTokens: number } }).config;
const reply = (text: string, finishReason = "STOP") => ({ text, functionCalls: [], candidates: [{ finishReason }] });

describe("chat gateway — answer budget vs thinking budget", () => {
  beforeEach(() => generateContent.mockReset());

  it("asks for MORE than the caller's budget, so thinking cannot eat the answer", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    await call(160);
    // The exact reserve is tunable; what must hold is that the answer keeps its
    // full 160 tokens and thinking is funded separately.
    expect(configOf().maxOutputTokens).toBeGreaterThan(160);
  });

  it("scales the ceiling with the caller's budget rather than pinning it flat", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    await call(160);
    const small = configOf().maxOutputTokens;
    generateContent.mockReset();
    generateContent.mockResolvedValue(reply("ok"));
    await call(2048);
    expect(configOf().maxOutputTokens - small).toBe(2048 - 160);
  });

  it("still funds thinking when the caller names no budget", async () => {
    generateContent.mockResolvedValue(reply("ok"));
    await call();
    expect(configOf().maxOutputTokens).toBeGreaterThan(1024);
  });

  it("flags a reply that stopped at the ceiling", async () => {
    generateContent.mockResolvedValue(reply("Maa Kali ke mand", "MAX_TOKENS"));
    expect((await call(160)).truncated).toBe(true);
  });

  it("does not flag a reply that ended naturally", async () => {
    generateContent.mockResolvedValue(reply("All done."));
    expect((await call(160)).truncated).toBe(false);
  });

  it("treats a missing finishReason as not truncated (never blocks a good send)", async () => {
    generateContent.mockResolvedValue({ text: "All done.", functionCalls: [] });
    expect((await call(160)).truncated).toBe(false);
  });
});
