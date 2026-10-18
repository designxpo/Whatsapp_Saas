// A tracked link is 532 characters and about 440 of them are invisible: the ref
// code is 49 zero-width characters and each percent-encodes to nine bytes. That
// is fine in an href and unusable in an Instagram bio or on a poster.
//
// /s/<slug> fixes the length WITHOUT touching the payload, and these tests are
// mostly about that word "without". Shortening the URL while quietly dropping
// the invisible code would look like a complete success — short link, opens
// WhatsApp, prefilled message reads correctly — and every conversation from it
// would arrive unattributed. Nothing on screen would say so.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  missingColumn: false,
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from(table: string) {
      const rowsOf = () => (h.tables[table] ??= []);
      return {
        select() {
          const filters: [string, unknown][] = [];
          // A filter on a column the fixture row does not carry (tenant_id) is a
          // no-op: the queries here are tenant-scoped, the fixtures are not.
          const rows = () => rowsOf().filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v));
          const builder = {
            eq(k: string, v: unknown) { filters.push([k, v]); return builder; },
            order() { return builder; },
            async maybeSingle() { const hit = rows()[0]; return { data: hit ? { ...hit } : null, error: null }; },
            then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
              resolve({ data: rows().map(r => ({ ...r })), error: null });
            },
          };
          return builder;
        },
        insert(row: Record<string, unknown>) {
          const chain = {
            select() { return chain; },
            async single() {
              rowsOf().push({ ...row });
              return { data: { ...row }, error: null };
            },
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          // Tenant-scoped AND by id, so the chain takes several .eq and resolves
          // only when awaited.
          const filters: [string, unknown][] = [];
          const u = {
            eq(k: string, v: unknown) { filters.push([k, v]); return u; },
            then(resolve: (v: { error: { code: string } | null }) => void) {
              if (h.missingColumn && "short_slug" in patch) return resolve({ error: { code: "42703" } });
              const matches = (r: Record<string, unknown>) => filters.every(([k, v]) => !(k in r) || r[k] === v);
              // The unique index from 0091, enforced here so the "already
              // taken" path is exercised rather than assumed.
              if (typeof patch.short_slug === "string") {
                const clash = rowsOf().some(r => r.short_slug === patch.short_slug && !matches(r));
                if (clash) return resolve({ error: { code: "23505" } });
              }
              for (const r of rowsOf()) if (matches(r)) Object.assign(r, patch);
              resolve({ error: null });
            },
          };
          return u;
        },
      };
    },
  }),
  serviceDb: () => ({}),
}));

import {
  mintShortSlug, normalizeSlug, shortUrl, resolveShortLink, recordShortClick,
  setShortSlug, ensureShortSlug, trackedLink, parseRef, starterMessage,
} from "../handlehub";

const EP = {
  id: "ep1", label: "Organic", number: "919266090124", handle: "",
  greeting: "Hi, I want to Know about AnalytixLabs courses", created_at: "2026-01-01",
};
const SRC = {
  id: "s1", entry_point_id: "ep1", label: "Instagram bio", ref_code: "1kgvrrb",
  kind: "link", message: null, touches: 4, short_clicks: 0, short_slug: "k7m2p",
  tenant_id: "tenant-a", created_at: "2026-01-01",
};

beforeEach(() => {
  h.missingColumn = false;
  h.tables = { wa_handle_entry_points: [{ ...EP }], wa_handle_sources: [{ ...SRC }] };
});

describe("minting a slug", () => {
  it("never uses a character a person could misread off a poster", () => {
    // 0/O/o and 1/l/I are the whole reason for a custom alphabet. A slug that
    // cannot be transcribed is not short, it is broken.
    const slugs = Array.from({ length: 400 }, () => mintShortSlug());
    expect(slugs.every(s => s.length === 5)).toBe(true);
    expect(slugs.some(s => /[0O1lI]/.test(s))).toBe(false);
    expect(slugs.every(s => /^[23456789abcdefghjkmnpqrstuvwxyz]{5}$/.test(s))).toBe(true);
  });

  it("does not repeat itself", () => {
    // Not a uniqueness proof — the database index is that. This catches a
    // generator that returns a constant, which every other test would pass.
    const slugs = new Set(Array.from({ length: 500 }, () => mintShortSlug()));
    expect(slugs.size).toBeGreaterThan(490);
  });
});

describe("a slug someone typed", () => {
  it("accepts a readable one and lowercases it", () => {
    // "/s/DS360" and "/s/ds360" must not be two different links.
    expect(normalizeSlug("DS360")).toBe("ds360");
    expect(normalizeSlug("  data-science  ")).toBe("data-science");
    expect(normalizeSlug("/ds360/")).toBe("ds360");
  });

  it("refuses shapes that would make an unusable or ambiguous URL", () => {
    expect(normalizeSlug("")).toBeNull();
    expect(normalizeSlug("a")).toBeNull();               // one character
    expect(normalizeSlug("-abc")).toBeNull();            // leading hyphen
    expect(normalizeSlug("abc-")).toBeNull();            // trailing hyphen
    expect(normalizeSlug("a--b")).toBeNull();            // doubled hyphen
    expect(normalizeSlug("has space")).toBeNull();
    expect(normalizeSlug("emoji😀")).toBeNull();
    expect(normalizeSlug("x".repeat(40))).toBeNull();
  });

  it("builds the URL without doubling the slash", () => {
    expect(shortUrl("https://waba.analytixlabs.co.in/", "k7m2p")).toBe("https://waba.analytixlabs.co.in/s/k7m2p");
    expect(shortUrl("https://waba.analytixlabs.co.in", "k7m2p")).toBe("https://waba.analytixlabs.co.in/s/k7m2p");
  });
});

describe("resolving /s/<slug>", () => {
  it("returns the source, its number's entry point, and the owning tenant", async () => {
    const t = await resolveShortLink("k7m2p");
    expect(t?.source.refCode).toBe("1kgvrrb");
    expect(t?.entryPoint.number).toBe("919266090124");
    // The tenant is RETURNED, not adopted: /s/ has no session, so the slug is
    // what says which business this is — the same job a site_key does.
    expect(t?.tenantId).toBe("tenant-a");
  });

  it("the target STILL carries the invisible ref code — the whole point", async () => {
    const t = await resolveShortLink("k7m2p");
    const text = decodeURIComponent(new URL(t!.link).searchParams.get("text")!);
    // Decoded by the same function the inbound webhook uses, so this asserts
    // attribution end to end rather than the mere presence of odd characters.
    expect(parseRef(text)).toBe("1kgvrrb");
    expect(t!.link).toBe(trackedLink({ number: EP.number, handle: "", greeting: EP.greeting }, { refCode: "1kgvrrb" }));
  });

  it("is dramatically shorter than what it redirects to", async () => {
    const t = await resolveShortLink("k7m2p");
    const short = shortUrl("https://waba.analytixlabs.co.in", "k7m2p");
    expect(t!.link.length).toBeGreaterThan(500);
    expect(short.length).toBeLessThan(45);
  });

  it("is case-insensitive, because a poster is", async () => {
    expect((await resolveShortLink("K7M2P"))?.source.id).toBe("s1");
  });

  it("resolves nothing rather than guessing", async () => {
    expect(await resolveShortLink("nope1")).toBeNull();
    expect(await resolveShortLink("")).toBeNull();
    expect(await resolveShortLink("../../etc")).toBeNull();
  });

  it("refuses when the entry point has lost its number", async () => {
    // An edit that blanks the number would otherwise redirect to
    // "https://wa.me/?text=…", which opens WhatsApp with no recipient.
    h.tables.wa_handle_entry_points[0].number = "";
    expect(await resolveShortLink("k7m2p")).toBeNull();
  });

  it("reflects a later edit to the greeting, because the target is computed not stored", async () => {
    h.tables.wa_handle_entry_points[0].greeting = "Tell me about the Data Science course";
    const t = await resolveShortLink("k7m2p");
    expect(decodeURIComponent(t!.link)).toContain("Tell me about the Data Science course");
    // and the code rode along with the new wording
    expect(parseRef(decodeURIComponent(new URL(t!.link).searchParams.get("text")!))).toBe("1kgvrrb");
  });

  it("uses the source's own starter message when it has one", async () => {
    h.tables.wa_handle_sources[0].message = "I saw your Instagram post";
    const t = await resolveShortLink("k7m2p");
    const text = decodeURIComponent(new URL(t!.link).searchParams.get("text")!);
    expect(text).toContain("I saw your Instagram post");
    expect(text).not.toContain("AnalytixLabs courses");
    expect(starterMessage({ greeting: EP.greeting }, { refCode: "1kgvrrb", message: "I saw your Instagram post" })).toBe(text);
  });
});

describe("counting an open", () => {
  it("increments short_clicks and leaves touches alone", async () => {
    // `touches` means "conversations actually started" — the inbound webhook
    // owns it and the portal renders it as "N chats". Counting a click there
    // would inflate the only number that currently means a real conversation.
    await recordShortClick("s1");
    await recordShortClick("s1");
    const row = h.tables.wa_handle_sources[0];
    expect(row.short_clicks).toBe(2);
    expect(row.touches).toBe(4);
    expect(row.short_last_click_at).toBeTruthy();
  });

  it("never throws, whatever the database does", async () => {
    await expect(recordShortClick("does-not-exist")).resolves.toBeUndefined();
  });
});

describe("choosing a slug", () => {
  it("stores a valid one", async () => {
    expect(await setShortSlug("s1", "DS-360", "tenant-a")).toBe("ds-360");
    expect(h.tables.wa_handle_sources[0].short_slug).toBe("ds-360");
  });

  it("says a taken slug is taken, instead of failing silently", async () => {
    h.tables.wa_handle_sources.push({ ...SRC, id: "s2", short_slug: "ds360" });
    await expect(setShortSlug("s1", "ds360", "tenant-a")).rejects.toThrow(/already taken/i);
    expect(h.tables.wa_handle_sources[0].short_slug).toBe("k7m2p");   // unchanged
  });

  it("explains itself when the shape is wrong", async () => {
    await expect(setShortSlug("s1", "a", "tenant-a")).rejects.toThrow(/2.31 characters/);
  });

  it("names the migration when the column is not there yet", async () => {
    h.missingColumn = true;
    await expect(setShortSlug("s1", "ds360", "tenant-a")).rejects.toThrow(/0091/);
  });
});

describe("filling in a missing slug", () => {
  it("leaves an existing slug alone — it may already be printed", async () => {
    expect(await ensureShortSlug("s1", "tenant-a")).toBe("k7m2p");
  });

  it("mints one when the row has none", async () => {
    h.tables.wa_handle_sources[0].short_slug = null;
    const slug = await ensureShortSlug("s1", "tenant-a");
    expect(slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{5}$/);
    expect(h.tables.wa_handle_sources[0].short_slug).toBe(slug);
  });

  it("returns null rather than throwing when 0091 is not applied", async () => {
    // The portal page must still render; the short link is simply absent.
    h.tables.wa_handle_sources[0].short_slug = null;
    h.missingColumn = true;
    expect(await ensureShortSlug("s1", "tenant-a")).toBeNull();
  });
});

// The route file itself. entrypoint-tenant-coverage only scans api/webhooks,
// api/widget and api/cron, so a public page route like this one is outside it —
// which means nothing else in the suite would notice if the wiring here was
// undone.
describe("the /s/<slug> route", () => {
  const src = readFileSync(join(__dirname, "../../app/s/[slug]/route.ts"), "utf8");

  it("looks the slug up unscoped — a public link has no session", () => {
    // The slug is what establishes the tenant, so the lookup cannot itself be
    // scoped to one; the row carries tenant_id back.
    expect(src).toContain("resolveShortLink");
  });

  it("sends the visitor through the /chat attribution bridge, carrying their UTMs", () => {
    // Unlike a bare wa.me redirect, the bridge can record where the visitor came
    // from before handing them to WhatsApp.
    expect(src).toContain("bridgeUrl");
    expect(src).toMatch(/utm_\(source\|medium\|campaign\|term\|content\)\|gclid\|fbclid\|sclx_id/);
  });

  it("counts the click after the response rather than before it", () => {
    // A counter must never stand between a visitor and WhatsApp.
    expect(src).toMatch(/after\(\(\) =>/);
    expect(src).toContain("recordShortClick");
  });

  it("redirects with 302 and refuses to be cached", () => {
    // The target is recomputed per request so an edit reaches printed links.
    // A cached 302 would defeat exactly that.
    expect(src).toMatch(/redirect\([^)]*,\s*302\)/);
    expect(src).toMatch(/Cache-Control["'\s,]+.*no-store/);
  });

  it("404s an unknown slug instead of sending somebody somewhere arbitrary", () => {
    expect(src).toMatch(/status:\s*404/);
  });
});

// The country code, which every entry point was missing.
//
// All three were stored as bare 10-digit numbers, so every tracked link, QR
// code and short link pointed at wa.me/9266090124 — which WhatsApp reads as
// country code 92, Pakistan. Nothing normalised, validated or warned. Google
// Business Profile refused the link ("Invalid WhatsApp click to chat link"),
// which is how it was noticed, after weeks of assets carrying it.
describe("an entry point number must carry its country code", () => {
  it("accepts a full international number", async () => {
    const { entryPointNumberProblem } = await import("../handlehub");
    expect(entryPointNumberProblem("919266090124")).toBeNull();
    expect(entryPointNumberProblem("+91 92660 90124")).toBeNull();   // punctuation is stripped
    expect(entryPointNumberProblem("14155552671")).toBeNull();       // US, 11 digits
  });

  it("rejects the bare national number that caused this", async () => {
    const { entryPointNumberProblem } = await import("../handlehub");
    for (const n of ["9266090124", "9555525908"]) {
      const p = entryPointNumberProblem(n);
      expect(p, n).toMatch(/country code/i);
      expect(p, n).toContain(`91${n}`);   // says what it should have been
    }
  });

  it("does NOT silently prepend 91", async () => {
    // Guessing a country is right for India and wrong everywhere else, and a
    // number saved under the wrong country fails exactly as invisibly as no
    // country at all. Refuse and explain instead.
    const { entryPointNumberProblem } = await import("../handlehub");
    expect(entryPointNumberProblem("9266090124")).not.toBeNull();
  });

  it("catches a leading national dialling 0", async () => {
    const { entryPointNumberProblem } = await import("../handlehub");
    expect(entryPointNumberProblem("09555219007")).toMatch(/leading 0/);
  });

  it("still refuses an empty number, and an absurdly long one", async () => {
    const { entryPointNumberProblem } = await import("../handlehub");
    expect(entryPointNumberProblem("")).toMatch(/required/);
    expect(entryPointNumberProblem("   ")).toMatch(/required/);
    expect(entryPointNumberProblem("9".repeat(16))).toMatch(/at most 15/);
  });

  it("is actually wired into create AND update, not just exported", async () => {
    // A validator nothing calls is the same as no validator.
    const src = (await import("fs")).readFileSync(
      (await import("path")).join(__dirname, "../handlehub.ts"), "utf8");
    const calls = src.split("entryPointNumberProblem(number)").length - 1;
    expect(calls, "expected createEntryPoint and updateEntryPoint to both check").toBe(2);
  });
});
