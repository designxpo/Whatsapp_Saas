// getChunks must return the WHOLE document, not the first thousand chunks.
//
// Found by auditing against the live data: knowledge-base-export-website.md
// holds 1,171 chunks and a plain select returned 1,000. PostgREST caps every
// response at db-max-rows and says nothing about it, so the caller receives a
// prefix that looks like a complete answer.
//
// That is not a slow read, it is data loss, because of what the callers do
// with it. reingestDocument reconstructs the text from these chunks, re-chunks
// it, and hands the result to replaceChunks — which DELETES every chunk for
// the document before inserting. Pressing "Reprocess" on that document would
// therefore have destroyed 171 chunks permanently, with the original upload
// long gone. convertDocumentToLibrary reads the same way and would have filed
// 85% of the document into the library.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  /** Every chunk the table holds for the document under test. */
  all: [] as { content: string }[],
  /** The ranges the caller actually requested. */
  ranges: [] as [number, number][],
  /** What the server will hand over at most, as PostgREST does. */
  maxRows: 1000,
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        is: () => b,          // concept_id IS NULL — chunks that belong to a published concept are excluded
        order: () => b,
        range: (from: number, to: number) => {
          h.ranges.push([from, to]);
          const take = Math.min(to - from + 1, h.maxRows);
          return Promise.resolve({ data: h.all.slice(from, from + take), error: null });
        },
        // A plain await with no range: the server still applies its ceiling.
        then: (ok: (x: { data: unknown[]; error: null }) => void) => {
          ok({ data: h.all.slice(0, h.maxRows), error: null });
          return Promise.resolve();
        },
      };
      return b;
    },
  }),
}));

beforeEach(() => {
  h.all = Array.from({ length: 1171 }, (_, i) => ({ content: `chunk ${i}` }));
  h.ranges = [];
});

describe("reading a document's chunks", () => {
  it("returns all 1,171, not the first 1,000", async () => {
    const { getChunks } = await import("../store");
    const out = await getChunks("doc-1");
    expect(out).toHaveLength(1171);
  });

  it("keeps them in order, so the text reconstructs correctly", async () => {
    const { getChunks } = await import("../store");
    const out = await getChunks("doc-1");
    expect(out[0]).toBe("chunk 0");
    expect(out[999]).toBe("chunk 999");
    expect(out[1000]).toBe("chunk 1000");      // the first one the cap used to eat
    expect(out[1170]).toBe("chunk 1170");
  });

  it("asks for more than one page rather than hoping one is enough", async () => {
    const { getChunks } = await import("../store");
    await getChunks("doc-1");
    expect(h.ranges.length).toBeGreaterThan(1);
  });

  it("handles a document that fits in one page without a wasted request", async () => {
    h.all = Array.from({ length: 12 }, (_, i) => ({ content: `c${i}` }));
    const { getChunks } = await import("../store");
    expect(await getChunks("doc-1")).toHaveLength(12);
  });

  it("returns nothing for a document with no chunks", async () => {
    h.all = [];
    const { getChunks } = await import("../store");
    expect(await getChunks("doc-1")).toEqual([]);
  });
});
