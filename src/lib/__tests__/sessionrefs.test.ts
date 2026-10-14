// Per-visitor attribution in a multi-tenant product.
//
// A source code says which LINK was clicked and is shared by everyone who
// clicks it. A session code says which VISITOR, and carries where they came
// from. The two must never be confused, which is what the length difference
// is for: a source code is always 7 characters, a session code always 12.
//
// The multi-tenant twist: /chat has no session, so the ref code is the only
// thing that says which business a visitor belongs to. Resolution is
// therefore unscoped and the ROW carries the tenant — get that backwards and
// one business's ad spend is attributed to another's.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  sources: [] as Record<string, unknown>[],
  entryPoints: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
}));

vi.mock("../supabase", () => {
  const pick = (t: string) => (t === "wa_session_refs" ? h.rows : t === "wa_handle_sources" ? h.sources : h.entryPoints);
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const api: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => {
        if (!h.insertError) pick(table).push(row);
        return Promise.resolve({ error: h.insertError });
      },
      select: () => api,
      update: (patch: Record<string, unknown>) => {
        for (const r of pick(table)) {
          if (Object.entries(filters).every(([k, v]) => r[k] === v)) Object.assign(r, patch);
        }
        return Promise.resolve({ error: null });
      },
      eq: (k: string, v: unknown) => { filters[k] = v; return api; },
      order: () => api,
      maybeSingle: () => Promise.resolve({
        data: pick(table).find(r => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null,
      }),
      then: (res: (x: { data: unknown[] }) => unknown) =>
        res({ data: pick(table).filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)) }),
    };
    return api;
  };
  return { db: () => ({ from: (t: string) => builder(t) }) };
});
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:," } }));

const { createSessionRef, resolveSessionRef, markSessionRefMatched, resolveBridgeTarget } = await import("../handlehub");

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  h.rows = []; h.sources = []; h.entryPoints = []; h.insertError = null;
});

describe("minting a session", () => {
  it("creates a row for a visitor carrying only UTMs — no click id at all", async () => {
    // The gate used to be "gclid or sclx_id" upstream, which quietly meant
    // Google paid only. Facebook, organic, email and partner traffic all
    // arrive this way.
    const code = await createSessionRef({ tenantId: T1, utm: { source: "facebook", medium: "social", campaign: "oct" } });
    expect(code).toBeTruthy();
    expect(h.rows[0]).toMatchObject({ tenant_id: T1, utm_source: "facebook", utm_campaign: "oct" });
  });

  it("creates one for a click id alone", async () => {
    expect(await createSessionRef({ tenantId: T1, utm: { gclid: "Cj0" } })).toBeTruthy();
    expect(await createSessionRef({ tenantId: T1, utm: { fbclid: "IwA" } })).toBeTruthy();
  });

  it("refuses a visitor carrying genuinely nothing", async () => {
    expect(await createSessionRef({ tenantId: T1, utm: {} })).toBeNull();
    expect(await createSessionRef({ tenantId: T1 })).toBeNull();
    expect(h.rows).toHaveLength(0);
  });

  it("mints 12 characters, never 7 — a session must not look like a source", async () => {
    // Resolution tries session-first on length alone. A 7-char session code
    // would shadow a real source code and break campaign attribution.
    for (let i = 0; i < 25; i++) {
      const code = await createSessionRef({ tenantId: T1, utm: { gclid: "g" } });
      expect(code).toHaveLength(12);
      expect(/^[0-9a-z]{12}$/.test(code!)).toBe(true);
    }
  });

  it("returns null rather than throwing when the table is missing", async () => {
    // Migration not applied yet: the visitor still gets a working link.
    h.insertError = { message: 'relation "wa_session_refs" does not exist' };
    expect(await createSessionRef({ tenantId: T1, utm: { gclid: "g" } })).toBeNull();
  });
});

describe("resolving a session", () => {
  it("returns the visitor's origin AND the tenant that owns them", async () => {
    const code = (await createSessionRef({
      tenantId: T2, sourceRefCode: "abc1234",
      utm: { source: "google", medium: "cpc", campaign: "da-delhi", gclid: "Cj0" },
    }))!;
    const got = await resolveSessionRef(code);
    expect(got).toMatchObject({
      refCode: code, tenantId: T2, sourceRefCode: "abc1234",
      utm: { source: "google", medium: "cpc", campaign: "da-delhi", gclid: "Cj0" },
    });
  });

  it("ignores a 7-character SOURCE code without touching the table", async () => {
    expect(await resolveSessionRef("abc1234")).toBeNull();
  });

  it("is case-insensitive — the encoder lowercases everything it carries", async () => {
    const code = (await createSessionRef({ tenantId: T1, utm: { gclid: "g" } }))!;
    expect((await resolveSessionRef(code.toUpperCase()))?.refCode).toBe(code);
  });

  it("misses cleanly on an unknown code", async () => {
    expect(await resolveSessionRef("zzzzzzzzzzzz")).toBeNull();
  });

  it("records the match against the SENDER, so the row joins to a contact", async () => {
    const code = (await createSessionRef({ tenantId: T1, utm: { gclid: "g" } }))!;
    await markSessionRefMatched(code, "918368872108");
    expect(h.rows[0].matched_wa_id).toBe("918368872108");
    expect(h.rows[0].matched_at).toBeTruthy();
  });
});

describe("the /chat bridge, in a multi-tenant product", () => {
  beforeEach(() => {
    h.sources = [{ id: "s1", tenant_id: T2, entry_point_id: "e1", label: "ppc-wa-delhi", ref_code: "abc1234", kind: "ad", touches: 0, created_at: "" }];
    h.entryPoints = [{ id: "e1", tenant_id: T2, label: "PPC", number: "919555525908", handle: "", greeting: "Hi!", created_at: "" }];
  });

  it("resolves the owning tenant from the ref code alone", async () => {
    // A public visitor has no session; the code is the only thing that says
    // whose ad this was.
    const t = await resolveBridgeTarget("abc1234", { utm: { source: "google", medium: "cpc" } });
    expect(t?.tenantId).toBe(T2);
    expect(t?.link).toContain("wa.me/919555525908");
  });

  it("puts the SESSION code in the link when there is attribution to carry", async () => {
    const t = await resolveBridgeTarget("abc1234", { utm: { source: "google", medium: "cpc" } });
    expect(t?.sessionRefCode).toHaveLength(12);
    expect(h.rows[0]).toMatchObject({ tenant_id: T2, source_ref_code: "abc1234", utm_source: "google" });
  });

  it("falls back to the plain source code when there is nothing to carry", async () => {
    const t = await resolveBridgeTarget("abc1234", { utm: {} });
    expect(t?.sessionRefCode).toBeNull();
    expect(h.rows).toHaveLength(0);
    expect(t?.link).toBeTruthy();        // the visitor still reaches WhatsApp
  });

  it("returns null for an unknown code rather than guessing a number", async () => {
    // Sending a visitor to some other tenant's WhatsApp would be worse than
    // sending them nowhere.
    expect(await resolveBridgeTarget("nosuch1", {})).toBeNull();
    expect(await resolveBridgeTarget("", {})).toBeNull();
  });

  it("returns null when the entry point has lost its number", async () => {
    h.entryPoints = [{ id: "e1", tenant_id: T2, label: "PPC", number: "", handle: "", greeting: "Hi!", created_at: "" }];
    expect(await resolveBridgeTarget("abc1234", {})).toBeNull();
  });
});
