// Re-organise: an old library filed under a fixed shelf list is re-filed by content.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ rows: [] as Row[], assign: (_t: string) => null as string | null }));

vi.mock("../tenantdb", () => ({
  tdb: () => ({
    from() {
      const f: [string, unknown][] = [];
      let gt: string | null = null; let lim = 1e9;
      const apply = () => h.rows.filter(r => f.every(([k, v]) => r[k] === v) && (gt === null || String(r.id) > gt)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, lim);
      const b: Row = {
        select: () => b, order: () => b,
        eq: (k: string, v: unknown) => { f.push([k, v]); return b; },
        gt: (_k: string, v: string) => { gt = v; return b; },
        limit: (n: number) => { lim = n; return b; },
        update: (patch: Row) => { const u: Row = { eq: (k: string, v: unknown) => { f.push([k, v]); return u; }, then: (ok: (x: unknown) => void) => { for (const r of apply()) Object.assign(r, patch); ok({ error: null }); return Promise.resolve(); } }; return u; },
        then: (ok: (x: unknown) => void) => { ok({ data: apply().map(r => ({ ...r })), error: null }); return Promise.resolve(); },
      };
      return b;
    },
  }),
}));
vi.mock("../kbareas", async orig => ({
  ...(await orig<typeof import("../kbareas")>()),
  assignAreas: async (items: { title: string }[]) => items.map(i => ({ area: h.assign(i.title), confidence: 0.8, source: "model" })),
}));

import { reorganiseLibrary } from "../kbconcepts";

const row = (id: string, area: string, file: string, title: string): Row =>
  ({ id, area, path: `${area}/${file}`, title, body: "x".repeat(60), status: "active", type: "knowledge", tags: [], sources: [] });

beforeEach(() => { h.rows = []; });

describe("reorganiseLibrary", () => {
  it("moves concepts to the inferred area and rewrites the path", async () => {
    h.rows = [row("a1", "courses", "deluxe-suite.md", "Deluxe suite"), row("a2", "fees", "spa.md", "Spa")];
    h.assign = t => (t === "Spa" ? "spa" : "room-types");
    const r = await reorganiseLibrary("t1");
    expect(r).toMatchObject({ moved: 2, kept: 0, nextCursor: null });
    expect(h.rows.map(x => x.path)).toEqual(["room-types/deluxe-suite.md", "spa/spa.md"]);
    expect(h.rows.map(x => x.area)).toEqual(["room-types", "spa"]);
  });

  it("keeps a concept that is already right, or that cannot be placed", async () => {
    h.rows = [row("a1", "spa", "spa.md", "Spa"), row("a2", "fees", "x.md", "Unknown")];
    h.assign = t => (t === "Spa" ? "spa" : null);
    const r = await reorganiseLibrary("t1");
    expect(r).toMatchObject({ moved: 0, kept: 2 });
    expect(h.rows[1].area).toBe("fees");
  });

  it("numbers a file instead of overwriting one already at the destination", async () => {
    h.rows = [row("a1", "spa", "pricing.md", "Spa pricing"), row("a2", "fees", "pricing.md", "Room pricing")];
    h.assign = () => "spa";
    await reorganiseLibrary("t1");
    expect(h.rows[1].path).toBe("spa/pricing-2.md");
  });
});
