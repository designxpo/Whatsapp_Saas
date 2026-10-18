// Publishing the library, and retrieval reading from it.
//
// Two separate guarantees are pinned here, and they are the ones that decide
// whether this can be switched on safely:
//
//   1. Only ACTIVE concepts ever reach the vector index. A quarantined upload
//      that got embedded would make the whole status model decorative.
//   2. With the library off, retrieval behaves exactly as it does today. The
//      switch has to be reversible without a re-embed, or nobody will dare
//      throw it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  concepts: [] as Record<string, unknown>[],
  /** Chunk rows written, by concept. */
  written: [] as { conceptId: string; contents: string[] }[],
  deleted: [] as string[],
  embedCalls: 0,
  /** Which RPC retrieval reached for. */
  rpcs: [] as string[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from(table: string) {
      if (table === "kb_concepts") {
        const filters: [string, unknown][] = [];
        const b: Record<string, unknown> = {
          select: () => b,
          eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
          order: () => b,
          // Resolvable with or without a .limit(): the code under test does both.
          // tenant_id is stamped by the code under test but not carried by the fixtures.
          limit: () => Promise.resolve({
            data: h.concepts.filter(c => filters.every(([k, v]) => k === "tenant_id" && !(k in c) ? true : c[k] === v)),
            error: null,
          }),
          then: (ok: (x: { data: Record<string, unknown>[]; error: null }) => void) => {
            ok({ data: h.concepts.filter(c => filters.every(([k, v]) => k === "tenant_id" && !(k in c) ? true : c[k] === v)), error: null });
            return Promise.resolve();
          },
        };
        return b;
      }
      // kb_chunks
      return {
        // Tenant-scoped AND by concept, so the chain takes both and resolves when awaited.
        delete: () => {
          const d: Record<string, unknown> = {
            eq: (k: string, v: string) => { if (k === "concept_id") h.deleted.push(v); return d; },
            then: (ok: (x: { error: null }) => void) => { ok({ error: null }); return Promise.resolve(); },
          };
          return d;
        },
        insert: (rows: Record<string, unknown>[]) => {
          const id = String(rows[0]?.concept_id ?? "");
          const existing = h.written.find(w => w.conceptId === id);
          const contents = rows.map(r => String(r.content));
          if (existing) existing.contents.push(...contents);
          else h.written.push({ conceptId: id, contents });
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc: (name: string) => { h.rpcs.push(name); return Promise.resolve({ data: [], error: null }); },
  }),
}));

vi.mock("../errors", () => ({ errorMessage: (e: unknown) => String(e) }));

// Embedding is the expensive part. Stub the Gemini client itself rather than
// the kb module: retrieve() calls embedQuery INTERNALLY, so a module-boundary
// mock cannot intercept it.
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      embedContent: async ({ contents }: { contents: unknown[] }) => {
        h.embedCalls++;
        return { embeddings: (Array.isArray(contents) ? contents : [contents]).map(() => ({ values: new Array(768).fill(0.1) })) };
      },
    };
  },
}));
// This codebase embeds on the tenant's own key with the platform key as fallback.
// No tenant key here, so the platform key (set below) is the one used.
vi.mock("../ai/keys", () => ({ resolveTenantAi: async () => { throw new Error("no tenant key"); } }));
vi.mock("../model-allowlist", () => ({
  resolveModel: async () => "text-embedding-004",
  // kb.ts resolves its embedding model at import time through this one.
  resolveEmbedModel: (requested: string | null | undefined, fallback: string) => (requested ?? "").trim() || fallback,
}));

const concept = (over: Record<string, unknown> = {}) => ({
  id: "k1", path: "fees/tuition.md", area: "fees", type: "policy",
  title: "Tuition & EMI", description: null,
  body: "The programme fee is ₹85,000 and EMI instalments are available over six months.",
  tags: ["website"], status: "active", sources: ["Website export"], document_id: "d1", extra: {},
  ...over,
});

const ENV = { ...process.env };
beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-platform-key";
  vi.resetModules();
  process.env = { ...ENV, GEMINI_API_KEY: "k" };
  h.concepts = []; h.written = []; h.deleted = []; h.embedCalls = 0; h.rpcs = [];
});
afterEach(() => { process.env = { ...ENV }; });

describe("publishing the library", () => {
  it("embeds an active concept", async () => {
    h.concepts.push(concept());
    const { publishConcepts } = await import("../kbpublish");
    const r = await publishConcepts();
    expect(r.concepts).toBe(1);
    expect(h.written[0].conceptId).toBe("k1");
  });

  it("NEVER embeds a pending concept", async () => {
    // The quarantine guarantee is worthless if the quarantined thing is
    // retrievable anyway.
    h.concepts.push(concept({ id: "k1", status: "active" }));
    h.concepts.push(concept({ id: "k2", path: "fees/other.md", status: "pending" }));
    const { publishConcepts } = await import("../kbpublish");
    await publishConcepts();
    expect(h.written.map(w => w.conceptId)).toEqual(["k1"]);
  });

  it("never embeds a superseded concept either", async () => {
    h.concepts.push(concept({ id: "k3", status: "superseded" }));
    const { publishConcepts } = await import("../kbpublish");
    const r = await publishConcepts();
    expect(r.concepts).toBe(0);
    expect(h.written).toEqual([]);
  });

  it("replaces one concept's vectors, not a whole document's", async () => {
    // Editing one line currently re-chunks and re-embeds all 1,171 chunks of
    // its file. The point of concept_id is that it no longer has to.
    h.concepts.push(concept());
    const { publishConcepts } = await import("../kbpublish");
    await publishConcepts({ conceptId: "k1" });
    expect(h.deleted).toEqual(["k1"]);          // by concept, not by document
  });

  it("keeps the title on the embedded text, so a fee is tied to its subject", async () => {
    // retrieve() ranks against a "[Document > Section]" header today, and it
    // is part of why a fees answer is not applied to the wrong course.
    h.concepts.push(concept());
    const { publishConcepts } = await import("../kbpublish");
    await publishConcepts();
    expect(h.written[0].contents.join(" ")).toContain("Tuition & EMI");
  });

  it("reports what it did, so a cron can log it", async () => {
    h.concepts.push(concept());
    h.concepts.push(concept({ id: "k2", path: "fees/b.md" }));
    const { publishConcepts } = await import("../kbpublish");
    const r = await publishConcepts();
    expect(r.concepts).toBe(2);
    expect(r.chunks).toBeGreaterThanOrEqual(2);
  });
});

describe("which index retrieval reads", () => {
  it("uses the DOCUMENT index while the library is off — today's behaviour", async () => {
    delete process.env.KB_LIBRARY_LIVE;
    const { retrieve } = await import("../kb");
    await retrieve("what is the fee");
    expect(h.rpcs).toContain("match_kb_chunks");
    expect(h.rpcs.join(",")).not.toContain("concept");
  });

  it("uses the CONCEPT index once the library is live", async () => {
    process.env.KB_LIBRARY_LIVE = "true";
    const { retrieve } = await import("../kb");
    await retrieve("what is the fee");
    expect(h.rpcs.join(",")).toContain("match_kb_concept_chunks");
    expect(h.rpcs).not.toContain("match_kb_chunks");
  });

  it("scopes a tagged chat to the concept index too, not back to documents", async () => {
    process.env.KB_LIBRARY_LIVE = "true";
    const { retrieve } = await import("../kb");
    await retrieve("what is the fee", 6, "00000000-0000-0000-0000-000000000001", "brochure");   // (query, k, tenantId, tag)
    expect(h.rpcs.join(",")).toContain("match_kb_concept_chunks");
    expect(h.rpcs.join(",")).not.toMatch(/match_kb_chunks_by_tag/);
  });

  it("asks the coverage gate the same index the answer will come from", async () => {
    // A gate that probes documents while answers come from concepts would
    // report "we know this" about knowledge the assistant cannot reach.
    process.env.KB_LIBRARY_LIVE = "true";
    const { kbCoverage } = await import("../kb");
    await kbCoverage("what is the fee");
    expect(h.rpcs.join(",")).toContain("match_kb_concept_chunks");
  });

  it("treats any value other than true as off", async () => {
    process.env.KB_LIBRARY_LIVE = "1";
    const { retrieve } = await import("../kb");
    await retrieve("what is the fee");
    expect(h.rpcs).toContain("match_kb_chunks");
  });
});
