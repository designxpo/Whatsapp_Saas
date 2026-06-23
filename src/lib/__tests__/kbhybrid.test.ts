import { describe, it, expect, vi } from "vitest";

// fuseHybrid is pure; stub the DB leaf so importing kb.ts stays offline.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure fusion tests"); } }));

import { fuseHybrid } from "@/lib/kb";

describe("fuseHybrid — Reciprocal Rank Fusion", () => {
  it("a chunk both retrievers rank highly wins the top slot", () => {
    const vec = [
      { content: "shared", similarity: 0.7 },
      { content: "vec-only", similarity: 0.66 },
    ];
    const kw = [
      { content: "shared", rank: 0.9 },
      { content: "kw-only", rank: 0.5 },
    ];
    const out = fuseHybrid(vec, kw, 5);
    expect(out[0].content).toBe("shared");           // appears in both → highest fused score
  });

  it("recovers a keyword-only hit and gives it a floor-passing similarity", () => {
    const vec = [{ content: "vec-only", similarity: 0.7 }];
    const kw = [{ content: "kw-only", rank: 0.8 }];
    const out = fuseHybrid(vec, kw, 5);
    const kwHit = out.find(c => c.content === "kw-only");
    expect(kwHit).toBeTruthy();
    expect(kwHit!.similarity).toBeGreaterThanOrEqual(0.45);   // survives MIN_SIMILARITY in llm.ts
  });

  it("a vector-only hit keeps its real cosine similarity", () => {
    const out = fuseHybrid([{ content: "vec-only", similarity: 0.63 }], [], 5);
    expect(out[0]).toEqual({ content: "vec-only", similarity: 0.63 });
  });

  it("deduplicates by content and respects the k limit", () => {
    const vec = Array.from({ length: 10 }, (_, i) => ({ content: `c${i}`, similarity: 0.6 }));
    const kw = Array.from({ length: 10 }, (_, i) => ({ content: `c${i}`, rank: 0.6 }));   // same contents
    const out = fuseHybrid(vec, kw, 6);
    expect(out.length).toBe(6);
    expect(new Set(out.map(c => c.content)).size).toBe(6);     // no duplicates
  });

  it("keyword presence rescues a chunk whose vector score was below the floor", () => {
    // Same chunk: weak vector (0.30) but a keyword hit → must end up floor-passing.
    const out = fuseHybrid([{ content: "rescued", similarity: 0.30 }], [{ content: "rescued", rank: 0.9 }], 5);
    expect(out[0].content).toBe("rescued");
    expect(out[0].similarity).toBeGreaterThanOrEqual(0.45);
  });

  it("empty inputs yield an empty result", () => {
    expect(fuseHybrid([], [], 6)).toEqual([]);
  });
});
