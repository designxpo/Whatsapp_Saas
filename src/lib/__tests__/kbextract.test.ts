import { describe, it, expect, vi } from "vitest";

// kb.ts → store.ts → supabase. extractEmbeddedText / extractReadableText are pure
// (no DB, no network — extractReadableText takes HTML, not a URL), so stub the
// heaviest leaf to keep the import cheap and offline, same as the chunking tests.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure extraction tests"); } }));

import { extractEmbeddedText, extractReadableText } from "@/lib/kb";

// A Next.js App Router page: near-empty DOM, real content in RSC flight data.
const flight = (payload: string) =>
  `<!doctype html><html><body>${"<div>x</div>"}<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;

describe("extractEmbeddedText — recover content JS frameworks embed in the HTML", () => {
  it("mines prose from the Next.js RSC flight payload and drops the CSS classes around it", () => {
    const payload =
      `3:["$","p",null,{"className":"flex focus:ring-2 md:px-4 bg-dark-bg","children":` +
      `"Acme Robotics builds autonomous warehouse robots for mid-sized logistics companies across Europe."}]`;
    const out = extractEmbeddedText(flight(payload));
    expect(out).toContain("Acme Robotics builds autonomous warehouse robots");
    expect(out).not.toMatch(/focus:ring-2|bg-dark-bg|className/);
  });

  it("walks JSON-LD structured data for string values", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org", "@type": "FAQPage",
      answer: "Our refund policy lets customers return any item within thirty days for a full refund.",
    });
    const html = `<html><head><script type="application/ld+json">${ld}</script></head><body>Loading…</body></html>`;
    expect(extractEmbeddedText(html)).toContain("refund policy lets customers return any item");
  });

  it("returns nothing for a page with no embedded payload", () => {
    expect(extractEmbeddedText("<html><body>Loading…</body></html>")).toBe("");
  });
});

describe("extractReadableText — DOM first, embedded payload as the fallback", () => {
  const REAL_PARAGRAPH =
    "Northwind Coffee roasts single-origin beans sourced directly from smallholder farms in Ethiopia, " +
    "Colombia, and Guatemala. Every batch is roasted to order in small drums, cupped for quality, and " +
    "shipped within a day so it reaches you at peak freshness. Subscriptions ship weekly or fortnightly, " +
    "and you can pause or change your blend at any time from your account dashboard without any fees.";

  it("uses the rendered DOM for a server-rendered page (unchanged behaviour)", async () => {
    // >500 chars of real DOM text + a misleading flight payload that must be ignored.
    const html = `<html><body><main>${REAL_PARAGRAPH}</main>` +
      `<script>self.__next_f.push([1,${JSON.stringify('4:"Totally unrelated embedded sentence about penguins in Antarctica."')}])</script></body></html>`;
    const out = await extractReadableText(html);
    expect(out).toContain("Northwind Coffee roasts single-origin beans");
    expect(out).not.toContain("penguins in Antarctica");
  });

  it("recovers embedded content when the DOM is just a loading shell", async () => {
    const payload = `5:["$","section",null,{"children":` +
      `"Meridian Clinic offers same-day dental appointments, transparent pricing, and evening hours on weekdays."}]`;
    const html = `<html><body><div id="__next">Preparing awesomeness… Loading…</div>` +
      `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
    const out = await extractReadableText(html);
    expect(out).toContain("Meridian Clinic offers same-day dental appointments");
    expect(out).not.toMatch(/Preparing awesomeness|Loading/);
  });

  it("throws a guidance error when nothing readable exists (pure JS shell)", async () => {
    const html = `<html><body><div id="root">Loading…</div></body></html>`;
    await expect(extractReadableText(html)).rejects.toThrow(/JavaScript/);
  });

  it("does NOT mistake a real short page for a spinner just because it says 'loading'", async () => {
    // "loading dock" must survive — only true spinner phrasing is a shell.
    const html = `<html><body>Our loading dock is open to freight carriers every weekday ` +
      `from eight in the morning until six in the evening, and appointments are recommended.</body></html>`;
    const out = await extractReadableText(html);
    expect(out).toContain("loading dock is open to freight carriers");
  });
});
