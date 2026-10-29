// Each integration card — the one Integrations catalog — shows
// the company's own logo, served from public/integrations. Never hot-linked:
// the Iconify `logos:` URLs the grid used to load stopped resolving, and every
// card quietly fell back to its letter.
//
// Where they came from (Oct 2026), to refresh one:
// - Icon sets via api.iconify.design/<set>/<name>.svg (thesvg-color: Shopify,
//   Razorpay, Calendly (viewBox trimmed to the mark), Google Calendar and
//   Sheets (the 2026 marks), HubSpot, Meta, Slack, Microsoft Teams; logos:
//   webhooks).
// - Each company's current site icon: Cal.com, Pipedrive, Stripe, Typeform,
//   WooCommerce (gstatic faviconV2 at 256px); Freshworks (apple-touch-icon,
//   Freshsales' brand); Shiprocket and Cashfree (their own favicon files);
//   IndiaMART and LeadSquared (Google's s2 favicon at 256px); JustDial (its
//   Play Store icon).
// - Zoho CRM: the product logo from zohowebstatic.com, with the "Zoho CRM"
//   text group removed so the mark fills the tile.
//
// They are served from our own origin, so an SVG must never carry script.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "../inbound/catalog";

const TAB = readFileSync(join(process.cwd(), "src/app/admin/_tabs/IntegrationsTab.tsx"), "utf8");

const PUBLIC = join(process.cwd(), "public");

describe("integration logos", () => {
  it("every integration has its company's logo", () => {
    expect(CATALOG.filter(e => !e.logo).map(e => e.id)).toEqual([]);
  });

  it("every logo is a file this app serves", () => {
    const missing = CATALOG.filter(e => e.logo && (!e.logo.startsWith("/integrations/") || !existsSync(join(PUBLIC, e.logo)))).map(e => `${e.id}: ${e.logo}`);
    expect(missing).toEqual([]);
  });

  it("no logo SVG can run anything", () => {
    const active = CATALOG.filter(e => e.logo?.endsWith(".svg")).flatMap(e => {
      const svg = readFileSync(join(PUBLIC, e.logo!), "utf8");
      const hits = [/<script/i, /\son[a-z]+\s*=/i, /<foreignObject/i, /javascript:/i, /href\s*=\s*["'](?!#)/i, /url\(\s*["']?(?!#)/i].filter(re => re.test(svg));
      return hits.length ? [`${e.id}: ${hits.join(", ")}`] : [];
    });
    expect(active).toEqual([]);
  });

  it("the Integrations grid's logos are this app's files too", () => {
    const logos = [...TAB.matchAll(/kind: "([a-z]+)", logo: (null|"[^"]*")/g)].map(m => [m[1], m[2]] as const);
    expect(logos.length).toBeGreaterThanOrEqual(12);
    const bad = logos.filter(([kind, l]) => l !== "null" && !existsSync(join(PUBLIC, JSON.parse(l)))
      || l === "null" && kind !== "mezmitra").map(([kind, l]) => `${kind}: ${l}`);
    expect(bad).toEqual([]);
  });
});
