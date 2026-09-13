// Which key pays for embeddings.
//
// This used to be the platform GEMINI_API_KEY and nothing else, which produced a
// genuinely baffling support case: a tenant pastes a valid Gemini key into the
// portal, their AI replies work perfectly, and their knowledge base is stone
// dead — because a second, invisible, platform-level key was unset. The portal
// gave no hint that two different keys were involved.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface EmbedReq { model: string; contents: string[]; config: { outputDimensionality: number; taskType: string } }
const embedCalls: { apiKey: string; model: string; dim: number }[] = [];
const failing = new Set<string>();
let tenantAi: { provider: string; apiKey: string; model: string } | null = null;

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    apiKey: string;
    constructor(o: { apiKey: string }) { this.apiKey = o.apiKey; }
    models = {
      embedContent: async (req: EmbedReq) => {
        if (failing.has(this.apiKey)) throw new Error(`key rejected: ${this.apiKey}`);
        embedCalls.push({ apiKey: this.apiKey, model: req.model, dim: req.config.outputDimensionality });
        return { embeddings: req.contents.map(() => ({ values: new Array(768).fill(0.01) })) };
      },
    };
  },
}));

vi.mock("../ai/keys", () => ({
  resolveTenantAi: async () => {
    if (!tenantAi) throw new Error("No AI chat key configured for this tenant");
    return tenantAi;
  },
}));

vi.mock("../store", () => ({
  DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  matchChunks: vi.fn(async () => []), matchChunksText: vi.fn(async () => []),
  matchChunksByTag: vi.fn(async () => []), matchChunksTextByTag: vi.fn(async () => []),
  replaceChunks: vi.fn(), setDocStatus: vi.fn(), setDocSync: vi.fn(),
  listSyncableUrlDocs: vi.fn(), getDocument: vi.fn(), getChunks: vi.fn(),
}));

const PLATFORM = "platform-key";
const OWN = "tenant-own-key";

beforeEach(() => {
  embedCalls.length = 0;
  failing.clear();
  tenantAi = null;
  process.env.GEMINI_API_KEY = PLATFORM;
});

describe("embedTexts — key preference", () => {
  it("prefers the tenant's own Gemini key over the platform key", async () => {
    tenantAi = { provider: "gemini", apiKey: OWN, model: "gemini-2.5-flash" };
    const { embedTexts } = await import("../kb");
    await embedTexts(["hello"], "RETRIEVAL_QUERY", "tenant-1");
    expect(embedCalls.map(c => c.apiKey)).toEqual([OWN]);
  });

  it("uses the platform key when the tenant has configured none", async () => {
    tenantAi = null;
    const { embedTexts } = await import("../kb");
    await embedTexts(["hello"], "RETRIEVAL_QUERY", "tenant-1");
    expect(embedCalls.map(c => c.apiKey)).toEqual([PLATFORM]);
  });

  it("ignores a non-Gemini tenant key rather than corrupting the vector space", async () => {
    // An OpenAI embedding is not comparable to the gemini-embedding-001 vectors
    // already in kb_chunks, and mixing them fails silently — every retrieval
    // just returns nonsense. So these tenants stay on the platform key.
    tenantAi = { provider: "openai", apiKey: "sk-openai", model: "gpt-4o" };
    const { embedTexts } = await import("../kb");
    await embedTexts(["hello"], "RETRIEVAL_QUERY", "tenant-1");
    expect(embedCalls.map(c => c.apiKey)).toEqual([PLATFORM]);
  });

  it("falls back to the platform key when the tenant's own key is rejected", async () => {
    // Saving a wrong or rate-limited key must not take a working KB down.
    tenantAi = { provider: "gemini", apiKey: OWN, model: "gemini-2.5-flash" };
    failing.add(OWN);
    const { embedTexts } = await import("../kb");
    const out = await embedTexts(["hello"], "RETRIEVAL_QUERY", "tenant-1");
    expect(embedCalls.map(c => c.apiKey)).toEqual([PLATFORM]);
    expect(out[0]).toHaveLength(768);
  });

  it("surfaces the tenant key's own error when there is no platform key to fall back to", async () => {
    tenantAi = { provider: "gemini", apiKey: OWN, model: "gemini-2.5-flash" };
    failing.add(OWN);
    delete process.env.GEMINI_API_KEY;
    const { embedTexts } = await import("../kb");
    await expect(embedTexts(["hello"], "RETRIEVAL_QUERY", "tenant-1")).rejects.toThrow(/key rejected/);
  });

  it("names both places a key can come from when neither exists", async () => {
    tenantAi = null;
    delete process.env.GEMINI_API_KEY;
    const { embedTexts } = await import("../kb");
    // The old message said only "GEMINI_API_KEY not configured", which pointed
    // an admin at the one place they had already looked.
    await expect(embedTexts(["hello"], "RETRIEVAL_QUERY", "tenant-1"))
      .rejects.toThrow(/Settings → AI.*GEMINI_API_KEY|GEMINI_API_KEY.*Settings → AI/s);
  });

  it("pins the model and dimension no matter whose key pays", async () => {
    tenantAi = { provider: "gemini", apiKey: OWN, model: "gemini-2.5-flash" };
    const { embedTexts, EMBED_DIM } = await import("../kb");
    await embedTexts(["hello"], "RETRIEVAL_DOCUMENT", "tenant-1");
    // The tenant's CHAT model (gemini-2.5-flash) must never leak into embedding.
    expect(embedCalls[0].model).toContain("embedding");
    expect(embedCalls[0].dim).toBe(EMBED_DIM);
  });

  it("does nothing at all for an empty batch — no key needed", async () => {
    delete process.env.GEMINI_API_KEY;
    const { embedTexts } = await import("../kb");
    await expect(embedTexts([], "RETRIEVAL_QUERY", "tenant-1")).resolves.toEqual([]);
    expect(embedCalls).toHaveLength(0);
  });
});
