// The boundary itself: retrieve() must NOT widen past a channel's allocated KB.
//
// effectiveKbScope decides whether a tag is a boundary; this pins what retrieve
// then does with that decision. They are worth testing separately because the
// leak lived in the gap between them — the scope was resolved correctly and
// then thrown away, so a tag that meant "only these docs" quietly became "these
// docs first, everything else if they come up short".

import { describe, it, expect, vi, beforeEach } from "vitest";

const matchChunks = vi.fn();
const matchChunksText = vi.fn();
const matchChunksByTag = vi.fn();
const matchChunksTextByTag = vi.fn();

vi.mock("../store", () => ({
  DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  matchChunks: (...a: unknown[]) => matchChunks(...a),
  matchChunksText: (...a: unknown[]) => matchChunksText(...a),
  matchChunksByTag: (...a: unknown[]) => matchChunksByTag(...a),
  matchChunksTextByTag: (...a: unknown[]) => matchChunksTextByTag(...a),
  replaceChunks: vi.fn(), setDocStatus: vi.fn(), setDocSync: vi.fn(),
  listSyncableUrlDocs: vi.fn(), getDocument: vi.fn(), getChunks: vi.fn(),
}));

// A deterministic stand-in for the embedding provider — retrieve() only passes
// the vector through to the (mocked) matchers, so its contents are irrelevant.
// The LENGTH is not: embedTexts validates it against EMBED_DIM.
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: async () => ({ embeddings: [{ values: new Array(768).fill(0.01) }] }) };
  },
}));

const OTHER_BRAND = { content: "Talko AI automates WhatsApp for businesses.", similarity: 0.72 };

describe("retrieve — a channel's KB is a boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY ??= "test-key";
    // The tagged KB has nothing for this question — the exact condition that
    // used to trigger the silent widening.
    matchChunksByTag.mockResolvedValue([]);
    matchChunksTextByTag.mockResolvedValue([]);
    // The general KB does have something, from a DIFFERENT brand's docs.
    matchChunks.mockResolvedValue([OTHER_BRAND]);
    matchChunksText.mockResolvedValue([{ content: OTHER_BRAND.content, rank: 0 }]);
  });

  it("returns nothing rather than another brand's docs when strict", async () => {
    const { retrieve } = await import("../kb");
    const out = await retrieve("what are your prices?", 6, "tenant-1", { tag: "spiritual-talks", strict: true });
    expect(out).toEqual([]);
    // The general-KB retrievers must not even be consulted.
    expect(matchChunks).not.toHaveBeenCalled();
    expect(matchChunksText).not.toHaveBeenCalled();
  });

  it("still widens for a flow-stamped focus, which is the same brand", async () => {
    const { retrieve } = await import("../kb");
    const out = await retrieve("what are your prices?", 6, "tenant-1", { tag: "masterclass", strict: false });
    expect(out.map(c => c.content)).toContain(OTHER_BRAND.content);
  });

  it("treats a bare string tag as the lenient legacy scope", async () => {
    // Any call site not yet migrated to effectiveKbScope keeps today's
    // behaviour rather than silently muting a channel.
    const { retrieve } = await import("../kb");
    const out = await retrieve("what are your prices?", 6, "tenant-1", "masterclass");
    expect(out.map(c => c.content)).toContain(OTHER_BRAND.content);
  });

  it("uses the general KB normally when no tag is set at all", async () => {
    const { retrieve } = await import("../kb");
    const out = await retrieve("what are your prices?", 6, "tenant-1", { tag: null, strict: false });
    expect(out.map(c => c.content)).toContain(OTHER_BRAND.content);
  });

  it("serves the tagged docs when they DO cover the question", async () => {
    const own = { content: "Our morning meditation runs at 6am.", similarity: 0.81 };
    matchChunksByTag.mockResolvedValue([own]);
    const { retrieve } = await import("../kb");
    const out = await retrieve("when is the session?", 6, "tenant-1", { tag: "spiritual-talks", strict: true });
    expect(out.map(c => c.content)).toEqual([own.content]);
    expect(matchChunks).not.toHaveBeenCalled();
  });
});

// ── Surviving an embedding outage ────────────────────────────────────────────
// Embeddings are the one thing charged to the PLATFORM Gemini key, so an unset
// or rate-limited GEMINI_API_KEY breaks vector search for every tenant at once.
// It used to throw out of retrieve() entirely, so generateReply saw zero chunks
// and answered from the model's own general knowledge — fluent, confident, and
// completely detached from the business's documents. Keyword search needs no
// embedding at all, so it must still run.
describe("retrieve — embedding outage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchChunks.mockResolvedValue([]);
    matchChunksByTag.mockResolvedValue([]);
  });

  it("still answers from the tagged KB by keyword when embeddings are down", async () => {
    vi.resetModules();
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = { embedContent: async () => { throw new Error("GEMINI_API_KEY not configured"); } };
      },
    }));
    matchChunksTextByTag.mockResolvedValue([{ content: "Our morning meditation runs at 6am.", rank: 0 }]);
    const { retrieve } = await import("../kb");
    const out = await retrieve("when is the session?", 6, "tenant-1", { tag: "spiritual-talks", strict: true });
    expect(out.map(c => c.content)).toEqual(["Our morning meditation runs at 6am."]);
    // The strict boundary must survive the outage too — no widening.
    expect(matchChunksText).not.toHaveBeenCalled();
  });

  it("returns nothing, not another brand's docs, when both retrievers come up empty", async () => {
    vi.resetModules();
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = { embedContent: async () => { throw new Error("GEMINI_API_KEY not configured"); } };
      },
    }));
    matchChunksTextByTag.mockResolvedValue([]);
    matchChunksText.mockResolvedValue([{ content: "Talko AI automates WhatsApp.", rank: 0 }]);
    const { retrieve } = await import("../kb");
    const out = await retrieve("what are your prices?", 6, "tenant-1", { tag: "spiritual-talks", strict: true });
    expect(out).toEqual([]);
  });
});
