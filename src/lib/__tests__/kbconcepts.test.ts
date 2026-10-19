// The ingest pipeline: an upload becomes concepts in the library, or it waits
// for a person. Exercised against a small in-memory fake of the exact
// PostgREST chains kbconcepts.ts calls — no real database.
//
// The behaviour these pin is the one the whole design exists for:
//
//     an upload can never silently change what the assistant tells a lead
//
// so the cases that matter most are the ones where an upload is REFUSED.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const CHUNKS = [{ content: "## Fees\n\nThe programme fee is \u20b985,000 and EMI instalments are available over six months." }];
const h = vi.hoisted(() => ({ rows: [] as Row[], seq: 0, failInsertOn: -1, inserts: 0 }));

vi.mock("../supabase", () => ({
  db: () => ({
    from(table: string) {
      if (table === "kb_documents") {
        const b: Row = {
          select: () => b, eq: () => b,
          maybeSingle: async () => ({ data: { id: "d1", title: "Brochure", tag: "brochure", source_type: "text", status: "ready" }, error: null }),
        };
        return b;
      }
      if (table === "kb_chunks") {
        const b: Row = {
          select: () => b, eq: () => b, is: () => b, order: () => b,
          // getChunks pages now (a plain select silently capped at 1,000 and
          // lost 15% of the largest document), so the fake must page too.
          range: (from: number, to: number) => Promise.resolve({ data: CHUNKS.slice(from, to + 1), error: null }),
          limit: () => Promise.resolve({ data: CHUNKS, error: null }),
          then: (ok: (x: { data: Row[]; error: null }) => void) => { ok({ data: CHUNKS, error: null }); return Promise.resolve(); },
        };
        return b;
      }
      if (table !== "kb_concepts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) };
      }
      const filters: [string, unknown][] = [];
      // tenant_id is stamped by the code under test but not carried by the seeded
      // fixtures, so a filter on it is a no-op: each test is a single workspace.
      const apply = () => h.rows.filter(r => filters.every(([k, v]) => k === "tenant_id" && !(k in r) ? true : Array.isArray(v) ? (v as unknown[]).includes(r[k]) : r[k] === v));
      const b: Row = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        in: (k: string, v: unknown[]) => { filters.push([k, v]); return b; },
        order: () => b,
        limit: () => Promise.resolve({ data: apply().map(r => ({ ...r })), error: null }),
        maybeSingle: async () => ({ data: apply()[0] ? { ...apply()[0] } : null, error: null }),
        then: (ok: (x: { data: Row[]; error: null }) => void) => { ok({ data: apply().map(r => ({ ...r })), error: null }); return Promise.resolve(); },
        insert: (v: Row | Row[]) => {
          if (h.inserts++ === h.failInsertOn) throw new Error("insert failed: connection reset");
          const list = Array.isArray(v) ? v : [v];
          const made = list.map(r => ({ id: `c${h.seq++}`, status: "pending", tags: [], sources: [], extra: {}, ...r }));
          h.rows.push(...made);
          return { select: () => ({ then: (ok: (x: { data: Row[]; error: null }) => void) => { ok({ data: made, error: null }); return Promise.resolve(); } }) };
        },
        update: (patch: Row) => {
          const u: Row = {
            eq: (k: string, v: unknown) => { filters.push([k, v]); return u; },
            then: (ok: (x: { error: null }) => void) => { for (const r of apply()) Object.assign(r, patch); ok({ error: null }); return Promise.resolve(); },
          };
          return u;
        },
      };
      return b;
    },
  }),
}));

vi.mock("../errors", () => ({ errorMessage: (e: unknown) => String(e) }));

const live = (over: Row = {}): Row => ({
  id: `live${h.seq++}`, path: "pricing/tuition-and-emi.md", area: "pricing", type: "policy",
  title: "Tuition & EMI", body: "The fee is ₹85,000 for 6 months.", tags: ["website"],
  sources: ["Website export"], status: "active", extra: {}, ...over,
});

beforeEach(() => { h.rows = []; h.seq = 0; h.failInsertOn = -1; h.inserts = 0; });

describe("filing an upload into the library", () => {
  it("publishes concepts on subjects nothing covers yet", async () => {
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary(
      { id: "d1", title: "Brochure", tag: "brochure" },
      "## Tuition and EMI\n\nThe fee is ₹85,000 and EMI is available over 6 months.",
    );
    expect(r.published).toBe(1);
    expect(r.quarantined).toBe(0);
    expect(h.rows[0].status).toBe("active");
    expect(h.rows[0].area).toBe("pricing");
  });

  it("files into the fixed spine, never into an area named after the upload", async () => {
    // The first dry run made nine areas named after source files, one holding
    // 1,338 of 1,515 concepts. That is the fault this prevents.
    const { ingestToLibrary } = await import("../kbconcepts");
    await ingestToLibrary(
      { id: "d1", title: "Some Random Export.pdf", tag: "random" },
      "## Our Noida centre\n\nClassroom batches run at the Noida centre address in Sector 2.",
    );
    expect(h.rows[0].area).toBe("locations");
    expect(String(h.rows[0].path)).toMatch(/^locations\//);
  });

  it("carries the upload's tag through, so channel scoping survives", async () => {
    const { ingestToLibrary } = await import("../kbconcepts");
    await ingestToLibrary(
      { id: "d1", title: "Brochure", tag: "brochure" },
      "## Fees\n\nThe fee is ₹85,000 with EMI and instalment options.",
    );
    expect(h.rows[0].tags).toContain("brochure");
  });

  it("records which upload each concept came from", async () => {
    const { ingestToLibrary } = await import("../kbconcepts");
    await ingestToLibrary({ id: "d1", title: "Brochure" }, "## Fees\n\nThe programme fee is ₹85,000 and EMI instalment options are available.");
    expect(h.rows[0].sources).toContain("Brochure");
    expect(h.rows[0].document_id).toBe("d1");
  });
});

describe("what an upload may NOT do", () => {
  it("quarantines a concept that contradicts an equally trusted live answer", async () => {
    h.rows.push(live({ tags: [], sources: ["Old brochure"] }));
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary(
      { id: "d2", title: "Old brochure" },
      "## Tuition and EMI\n\nThe programme fee is ₹90,000 and runs for 6 months, EMI available.",
    );
    expect(r.quarantined).toBe(1);
    expect(r.published).toBe(0);
  });

  it("leaves the live answer live and retrievable", async () => {
    h.rows.push(live());
    const { ingestToLibrary } = await import("../kbconcepts");
    await ingestToLibrary({ id: "d2", title: "Old brochure" }, "## Tuition and EMI\n\nThe programme fee is ₹90,000 and EMI instalments are available.");
    const actives = h.rows.filter(r => r.status === "active");
    expect(actives).toHaveLength(1);
    expect(String(actives[0].body)).toContain("85,000");     // unchanged
  });

  it("writes a review note naming both figures", async () => {
    h.rows.push(live({ tags: [], sources: ["Old brochure"] }));
    const { ingestToLibrary } = await import("../kbconcepts");
    await ingestToLibrary({ id: "d2", title: "Old brochure" }, "## Tuition and EMI\n\nThe programme fee is ₹90,000 and EMI instalments are available.");
    const pending = h.rows.find(r => r.status === "pending")!;
    expect(String(pending.review_note)).toMatch(/85000/);
    expect(String(pending.review_note)).toMatch(/90000/);
  });

  it("holds a concept it could not file, rather than dropping it in somewhere", async () => {
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary({ id: "d1", title: "Blog" }, "## Lorem\n\nThe quick brown fox jumped over the lazy dog repeatedly.");
    expect(r.quarantined).toBe(1);
    expect(h.rows[0].status).toBe("pending");
    expect(String(h.rows[0].review_note)).toMatch(/area|file/i);
  });

  it("merges a restatement that agrees instead of queueing noise", async () => {
    h.rows.push(live());
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary(
      { id: "d2", title: "Brochure", tag: "brochure" },
      "## Tuition and EMI\n\nFee: Rs 85,000. Duration 6 months. EMI available.",
    );
    expect(r.merged).toBe(1);
    expect(r.quarantined).toBe(0);
    const actives = h.rows.filter(r => r.status === "active");
    expect(actives).toHaveLength(1);
    expect((actives[0].tags as string[]).sort()).toEqual(["brochure", "website"]);
    expect((actives[0].sources as string[]).sort()).toEqual(["Brochure", "Website export"]);
  });

  it("drops fragments too thin to answer anything", async () => {
    // 116 of the real 1,515 concepts are section headers with no body —
    // "Offers", "Policies", "Important Dates". Storing them adds nothing and
    // fills the review queue.
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary({ id: "d1", title: "Doc" }, "## Offers\n\n## Policies\n\n## Important Dates");
    expect(r.skipped).toBeGreaterThan(0);
    expect(h.rows).toHaveLength(0);
  });
});

describe("only active concepts are answerable", () => {
  it("lists active concepts for embedding, never pending or superseded", async () => {
    h.rows.push(live({ path: "a/one.md" }));
    h.rows.push(live({ path: "a/two.md", status: "pending" }));
    h.rows.push(live({ path: "a/three.md", status: "superseded" }));
    const { listActiveConcepts } = await import("../kbconcepts");
    const out = await listActiveConcepts();
    expect(out.map(c => c.path)).toEqual(["a/one.md"]);
  });

  it("surfaces the review queue oldest first", async () => {
    h.rows.push(live({ path: "a/p.md", status: "pending", review_note: "conflicts" }));
    h.rows.push(live({ path: "a/ok.md" }));
    const { listPendingConcepts } = await import("../kbconcepts");
    const out = await listPendingConcepts();
    expect(out).toHaveLength(1);
    expect(out[0].reviewNote).toBe("conflicts");
  });
});

describe("resolving a conflict", () => {
  it("approving a pending concept retires the one it replaces", async () => {
    const existing = live();
    h.rows.push(existing);
    h.rows.push(live({ id: "pend1", path: "pricing/tuition-and-emi.md", body: "The fee is ₹90,000.", status: "pending" }));
    const { approveConcept } = await import("../kbconcepts");
    await approveConcept("pend1");
    expect(h.rows.find(r => r.id === "pend1")!.status).toBe("active");
    expect(h.rows.find(r => r.id === existing.id)!.status).toBe("superseded");
  });

  it("never leaves two concepts live at one path", async () => {
    h.rows.push(live());
    h.rows.push(live({ id: "pend1", path: "pricing/tuition-and-emi.md", body: "₹90,000.", status: "pending" }));
    const { approveConcept, listActiveConcepts } = await import("../kbconcepts");
    await approveConcept("pend1");
    const actives = await listActiveConcepts();
    expect(actives.filter(c => c.path === "pricing/tuition-and-emi.md")).toHaveLength(1);
  });

  it("rejecting leaves the live answer untouched", async () => {
    const existing = live();
    h.rows.push(existing);
    h.rows.push(live({ id: "pend1", path: "pricing/tuition-and-emi.md", body: "₹90,000.", status: "pending" }));
    const { rejectConcept } = await import("../kbconcepts");
    await rejectConcept("pend1");
    expect(h.rows.find(r => r.id === "pend1")!.status).toBe("superseded");
    expect(h.rows.find(r => r.id === existing.id)!.status).toBe("active");
  });
});

describe("what the review screen needs", () => {
  it("pairs a pending concept with the live one it argues with", async () => {
    // A reviewer cannot judge "₹90,000" alone. They need the number it would
    // replace, side by side, or the decision is a coin toss.
    h.rows.push(live({ id: "liveA" }));
    h.rows.push(live({ id: "pendA", status: "pending", body: "The fee is ₹90,000 and EMI is available.", review_note: "conflicts" }));
    const { listReviewItems } = await import("../kbconcepts");
    const items = await listReviewItems();
    expect(items).toHaveLength(1);
    expect(items[0].incoming.id).toBe("pendA");
    expect(items[0].live?.id).toBe("liveA");
  });

  it("shows a pending concept with no rival as a plain new entry", async () => {
    h.rows.push(live({ id: "pendB", path: "pricing/brand-new.md", status: "pending", review_note: "could not be filed" }));
    const { listReviewItems } = await import("../kbconcepts");
    const items = await listReviewItems();
    expect(items[0].live).toBeNull();
  });

  it("counts the library by area, so the browser can show sizes", async () => {
    h.rows.push(live({ id: "a", area: "pricing", path: "pricing/a.md" }));
    h.rows.push(live({ id: "b", area: "pricing", path: "pricing/b.md" }));
    h.rows.push(live({ id: "c", area: "locations", path: "locations/c.md" }));
    h.rows.push(live({ id: "d", area: "pricing", path: "pricing/d.md", status: "pending" }));
    const { conceptAreaSummary } = await import("../kbconcepts");
    const s = await conceptAreaSummary();
    expect(s.find(x => x.area === "pricing")).toMatchObject({ active: 2, pending: 1 });
    expect(s.find(x => x.area === "locations")).toMatchObject({ active: 1, pending: 0 });
  });
});

describe("editing a concept in the portal", () => {
  it("saves the body and keeps it live", async () => {
    h.rows.push(live({ id: "e1" }));
    const { updateConcept } = await import("../kbconcepts");
    const out = await updateConcept("e1", { body: "The fee is ₹85,000, revised wording." });
    expect(out?.body).toContain("revised wording");
    expect(h.rows.find(r => r.id === "e1")!.status).toBe("active");
  });

  it("saves tags, which is how channel scoping is edited", async () => {
    h.rows.push(live({ id: "e1" }));
    const { updateConcept } = await import("../kbconcepts");
    await updateConcept("e1", { tags: ["website", "brochure"] });
    expect((h.rows[0].tags as string[]).sort()).toEqual(["brochure", "website"]);
  });

  it("refuses to blank the body — an empty concept answers nothing", async () => {
    h.rows.push(live({ id: "e1" }));
    const { updateConcept } = await import("../kbconcepts");
    await expect(updateConcept("e1", { body: "   " })).rejects.toThrow(/body/i);
  });

  it("lets a concept move to a NEW area — areas are created by use, not declared", async () => {
    h.rows.push(live({ id: "e1", path: "pricing/tuition-and-emi.md", area: "pricing" }));
    const { updateConcept } = await import("../kbconcepts");
    const out = await updateConcept("e1", { area: "Room Types" });
    expect(out?.area).toBe("room-types");
    expect(out?.path).toBe("room-types/tuition-and-emi.md");
  });

  it("refuses an area name with nothing usable in it, because it becomes a directory", async () => {
    h.rows.push(live({ id: "e1" }));
    const { updateConcept } = await import("../kbconcepts");
    await expect(updateConcept("e1", { area: "!!!" })).rejects.toThrow(/usable area name/i);
  });

  it("re-addresses the concept when it moves area, so path still means subject", async () => {
    h.rows.push(live({ id: "e1", path: "pricing/tuition-and-emi.md", area: "pricing" }));
    const { updateConcept } = await import("../kbconcepts");
    const out = await updateConcept("e1", { area: "booking" });
    expect(out?.path).toBe("booking/tuition-and-emi.md");
  });
});

describe("converting an already-uploaded document", () => {
  it("rebuilds its text from stored chunks and files it", async () => {
    const { convertDocumentToLibrary } = await import("../kbconcepts");
    const r = await convertDocumentToLibrary("d1");
    expect(r.published).toBeGreaterThan(0);
    expect(h.rows.some(x => x.area === "pricing")).toBe(true);
  });

  it("is safe to run twice — the second pass merges, it does not duplicate", async () => {
    // A convert-all button that doubles the library on a second click is worse
    // than no button. reconcile() merges an agreeing restatement, and a
    // document restating itself agrees with itself.
    const { convertDocumentToLibrary } = await import("../kbconcepts");
    const first = await convertDocumentToLibrary("d1");
    const before = h.rows.length;
    const second = await convertDocumentToLibrary("d1");
    expect(h.rows.length).toBe(before);
    expect(second.published).toBe(0);
    expect(second.merged).toBe(first.published);
  });
})

describe("source precedence in the pipeline", () => {
  it("files an outranked upload away instead of queueing it for a person", async () => {
    // The brochure contradicting the website is not a question anybody needs
    // to answer — the ranking already answered it.
    h.rows.push(live({ tags: ["website"], sources: ["knowledge-base-export-website.md"] }));
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary(
      { id: "d9", title: "Brochure" },
      "## Tuition and EMI\n\nThe programme fee is ₹90,000 and EMI instalments are available.",
    );
    expect(r.outranked).toBe(1);
    expect(r.quarantined).toBe(0);
    expect(h.rows.filter(x => x.status === "active")).toHaveLength(1);
    expect(String(h.rows.find(x => x.status === "active")!.body)).toContain("85,000");
  });

  it("lets a better source replace the published answer, retiring the old one", async () => {
    h.rows.push(live({ tags: ["brochure"], sources: ["Brochure"] }));
    const { ingestToLibrary } = await import("../kbconcepts");
    const r = await ingestToLibrary(
      { id: "d10", title: "knowledge-base-export-website.md", tag: "website" },
      "## Tuition and EMI\n\nThe programme fee is ₹87,320 and EMI instalments are available.",
    );
    expect(r.published).toBe(1);
    const actives = h.rows.filter(x => x.status === "active");
    expect(actives).toHaveLength(1);
    expect(String(actives[0].body)).toContain("87,320");
    expect(h.rows.some(x => x.status === "superseded")).toBe(true);
  });
});

describe("one bad concept must not abandon the rest of the document", () => {
  it("keeps going when a single concept fails to store", async () => {
    // The whole loop sat inside one try, so a failure on concept 400 of 1,171
    // abandoned the remaining 771 and reported a count that looked like a
    // completed run. A document half-filed with no sign of it is worse than
    // one that failed outright.
    const { ingestToLibrary } = await import("../kbconcepts");
    h.failInsertOn = 1;                       // the second insert throws
    const r = await ingestToLibrary(
      { id: "dX", title: "Brochure" },
      ["## Fees", "", "The programme fee is ₹85,000 and EMI instalments are available.", "",
       "## Our Noida centre", "", "Classroom batches run at the Noida centre in Sector 2 daily.", "",
       "## Refund policy", "", "A 50% fee refund applies if you are not placed within six months."].join("\n"),
    );
    expect(r.failed).toBe(1);
    expect(r.published).toBe(2);               // the other two still landed
    expect(r.notes.join(" ")).toMatch(/insert/i);
  });
});

describe("moving a concept onto an occupied address", () => {
  it("explains the clash instead of surfacing a database error", async () => {
    // Two live concepts cannot share a path — the partial unique index says
    // so — and "duplicate key value violates unique constraint" is not a
    // sentence anybody can act on.
    h.rows.push(live({ id: "m1", path: "pricing/tuition.md", area: "pricing" }));
    h.rows.push(live({ id: "m2", path: "locations/tuition.md", area: "locations" }));
    const { updateConcept } = await import("../kbconcepts");
    await expect(updateConcept("m2", { area: "pricing" })).rejects.toThrow(/already/i);
  });

  it("allows the move when nothing is in the way", async () => {
    h.rows.push(live({ id: "m3", path: "locations/batch-dates.md", area: "locations" }));
    const { updateConcept } = await import("../kbconcepts");
    const out = await updateConcept("m3", { area: "booking" });
    expect(out?.path).toBe("booking/batch-dates.md");
  });
});
