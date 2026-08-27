import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveEmbedModel, isEmbedModelAllowed, ALLOWED_EMBED_MODELS } from "../model-allowlist";

// Scope note: this build is BYO-key. Chat and voice run on each tenant's OWN
// provider/model/key via resolveTenantAi (Gemini, OpenAI or Anthropic), so a
// tenant's model choice spends their money and is deliberately NOT constrained
// here. The platform Gemini key is spent in exactly one place — embeddings in
// kb.ts — so that is the only call this list governs.
//
// Two reasons it exists. The platform Gemini project was flagged by Google for
// suspicious activity in Aug 2026 (four Gemini 3.x models plus Nano Banana Pro,
// 228K output tokens in a day) with nothing in the app constraining which model
// the platform key could be pointed at. And a wrong embedding model returns
// vectors of a different dimension, silently corrupting kb_chunks and every
// retrieval that reads them — invisible until answers quietly get worse.

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

describe("the approved embedding model passes through", () => {
  it.each([...ALLOWED_EMBED_MODELS])("%s", (m) => {
    expect(resolveEmbedModel(m, "gemini-embedding-001", "test")).toBe(m);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("anything else is refused", () => {
  it.each([
    "gemini-3-pro-image-preview",     // the incident's image model
    "gemini-3.7-flash",
    "gemini-2.5-flash",               // a CHAT model — wrong dimensions
    "text-embedding-3-large",         // another provider's embedder
    "gemini-embedding-002",           // plausible future model, still not approved
    "gemini-embedding-001-typo",
  ])("%s falls back to the approved model", (m) => {
    expect(resolveEmbedModel(m, "gemini-embedding-001", "env:GEMINI_EMBED_MODEL")).toBe("gemini-embedding-001");
  });

  it("logs a greppable rejection naming the source to go fix", () => {
    resolveEmbedModel("gemini-3-pro-image-preview", "gemini-embedding-001", "env:GEMINI_EMBED_MODEL");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse((warn.mock.calls[0] as unknown as string[])[0])).toMatchObject({
      tag: "model_not_allowed",
      kind: "embed",
      requested: "gemini-3-pro-image-preview",
      source: "env:GEMINI_EMBED_MODEL",
      usedInstead: "gemini-embedding-001",
    });
  });

  it("never throws — a typo in an env var must not take the KB offline", () => {
    expect(() => resolveEmbedModel("nonsense", "gemini-embedding-001", "test")).not.toThrow();
  });
});

describe("empty means 'use the default', not 'rejected'", () => {
  it.each([null, undefined, "", "   "])("%p resolves silently to the fallback", (v) => {
    expect(resolveEmbedModel(v as string | null, "gemini-embedding-001", "test")).toBe("gemini-embedding-001");
    expect(warn).not.toHaveBeenCalled();
  });

  it("trims before matching", () => {
    expect(resolveEmbedModel("  gemini-embedding-001 ", "gemini-embedding-001", "test")).toBe("gemini-embedding-001");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("isEmbedModelAllowed", () => {
  it("accepts the approved model", () => expect(isEmbedModelAllowed("gemini-embedding-001")).toBe(true));
  it("rejects an image model", () => expect(isEmbedModelAllowed("gemini-3-pro-image-preview")).toBe(false));
  it("rejects a chat model", () => expect(isEmbedModelAllowed("gemini-2.5-flash")).toBe(false));
  it("rejects blank", () => {
    expect(isEmbedModelAllowed("")).toBe(false);
    expect(isEmbedModelAllowed(null)).toBe(false);
  });
});

describe("the list itself", () => {
  it("never contains an image-generation model", () => {
    for (const m of ALLOWED_EMBED_MODELS) expect(m).not.toMatch(/image|imagen|banana/i);
  });

  it("matches what we deliberately approved, exactly", () => {
    // Pinned so widening it requires editing this test too — no model starts
    // costing the platform money without someone deciding it.
    expect([...ALLOWED_EMBED_MODELS]).toEqual(["gemini-embedding-001"]);
  });

  it("every entry is an embedding model, not a chat one", () => {
    for (const m of ALLOWED_EMBED_MODELS) expect(m).toMatch(/embedding/);
  });
});
