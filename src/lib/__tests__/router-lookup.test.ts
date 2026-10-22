import { describe, it, expect, vi, beforeEach } from "vitest";

// The router's FAQ and cache layers are looked up by the STANDALONE question.
//
// They were keyed by the raw message, and the cache is shared by every lead in
// a workspace: a bare "fees?" was stored with whichever product's fee answer
// RAG produced, and the next lead to type "fees?" — about a different product —
// was served it by exact match. The memory layer still reads the raw words,
// because "tell me more" is what it recognises.

const h = vi.hoisted(() => ({ faq: [] as string[], cache: [] as string[], memory: [] as string[] }));

vi.mock("@/lib/llm", () => ({
  FALLBACK_REPLY: "fallback", SOFT_FALLBACK: "soft", CLARIFY_REPLY: "clarify",
  applyPersonaTone: async (a: string) => a,
}));
vi.mock("@/lib/kb", () => ({ kbCoverage: async () => null }));
vi.mock("../router/faq", () => ({ matchFaq: (q: string) => { h.faq.push(q); return null; } }));
vi.mock("../router/cache", () => ({
  cacheLookup: async (q: string) => { h.cache.push(q); return { hit: null, embedding: null }; },
  cacheStore: async () => undefined,
}));
vi.mock("../router/memory", () => ({
  loadMemory: async () => ({}), saveMemory: async () => undefined,
  resolveFollowUp: (m: string) => { h.memory.push(m); return null; },
}));
vi.mock("../router/metrics", () => ({ logRouterEvent: () => undefined }));

const { routeMessage } = await import("../router");

beforeEach(() => { h.faq = []; h.cache = []; h.memory = []; });

describe("routeMessage lookup", () => {
  it("matches the FAQ and the cache on the standalone question, memory on the raw words", async () => {
    await routeMessage({ conversationId: "c1", phone: "91900", message: "iski fees?", lookup: "What are the fees for the Bali tour?", tenantId: "t1" });
    expect(h.faq).toEqual(["What are the fees for the Bali tour?"]);
    expect(h.cache).toEqual(["What are the fees for the Bali tour?"]);
    expect(h.memory).toEqual(["iski fees?"]);
  });

  it("uses the message for everything when no lookup is given", async () => {
    await routeMessage({ conversationId: "c1", phone: "91900", message: "fees?", tenantId: "t1" });
    expect(h.faq).toEqual(["fees?"]);
    expect(h.cache).toEqual(["fees?"]);
  });
});
