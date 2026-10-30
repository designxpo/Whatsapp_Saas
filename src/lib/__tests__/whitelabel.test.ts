// White-label, Phase 2. The promise these tests hold: the current portal is
// untouched. With the switch off nothing white-label runs at all; with it on,
// Talko's own hosts still never become a partner's, and Talko's brand leaves
// every page, email and reply exactly as it was.
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  TALKO_BRAND, partnerSlugFromHost, whiteLabelConfig, checkBrandSettings, brandFromPartner,
  brandCopy, brandJson, type Brand,
} from "../whitelabel";
import { applyEmailBrand } from "../email-brand";
import { renderEmail, type EmailOptions } from "../emailtemplate";
import { SITE_URL } from "../siteurl";

const ON = { enabled: true, baseDomain: "thetalko.in" };
const OFF = { enabled: false, baseDomain: "thetalko.in" };

const PARTNER: Brand = {
  partnerId: "p1", slug: "brightdental", name: "Bright Dental", logoUrl: "https://cdn.example.com/bd.png",
  color: "#0d6efd", tagline: null, supportEmail: "help@bright.example", termsUrl: null, privacyUrl: null, poweredBy: true,
};

describe("partnerSlugFromHost", () => {
  it("does nothing while white-label is off", () => {
    expect(partnerSlugFromHost("brightdental.thetalko.in", OFF)).toBeNull();
  });
  it("never treats Talko's own hosts as a partner", () => {
    for (const h of ["app.thetalko.in", "www.thetalko.in", "thetalko.in", "api.thetalko.in", "support.thetalko.in", "localhost:3000", "talkoai.vercel.app"]) {
      expect(partnerSlugFromHost(h, ON)).toBeNull();
    }
  });
  it("reads a partner's address, ignoring case, port and a trailing dot", () => {
    expect(partnerSlugFromHost("BrightDental.thetalko.in:443", ON)).toBe("brightdental");
    expect(partnerSlugFromHost("brightdental.thetalko.in.", ON)).toBe("brightdental");
  });
  it("accepts one level only, and only real labels", () => {
    expect(partnerSlugFromHost("a.b.thetalko.in", ON)).toBeNull();
    expect(partnerSlugFromHost("-bad.thetalko.in", ON)).toBeNull();
    expect(partnerSlugFromHost("evilthetalko.in", ON)).toBeNull();
  });
  it("is off unless the switch says exactly 1", () => {
    expect(whiteLabelConfig({}).enabled).toBe(false);
    expect(whiteLabelConfig({ WHITE_LABEL_ENABLED: "true" }).enabled).toBe(false);
    expect(whiteLabelConfig({ WHITE_LABEL_ENABLED: "1", PARTNER_BASE_DOMAIN: ".Example.com." })).toEqual({ enabled: true, baseDomain: "example.com" });
  });
});

describe("brand settings and copy", () => {
  it("rejects unsafe or malformed values", () => {
    expect(checkBrandSettings({ logoUrl: "http://x.com/a.png" }).ok).toBe(false);
    expect(checkBrandSettings({ logoUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(checkBrandSettings({ color: "red" }).ok).toBe(false);
    expect(checkBrandSettings({ supportEmail: "nope" }).ok).toBe(false);
    expect(checkBrandSettings({ termsUrl: "ftp://x" }).ok).toBe(false);
  });
  it("fills gaps from the partner record, and Pro hides Powered by", () => {
    const b = brandFromPartner({ id: "p1", slug: "x", name: "X Co", tier: "pro", contactEmail: "a@x.co", brand: {} });
    expect(b).toMatchObject({ name: "X Co", supportEmail: "a@x.co", poweredBy: false, logoUrl: null });
  });
  it("leaves Talko's copy untouched and swaps the name for a partner", () => {
    expect(brandCopy("Finish setting up Talko AI", TALKO_BRAND)).toBe("Finish setting up Talko AI");
    expect(brandCopy("Finish setting up Talko AI", PARTNER)).toBe("Finish setting up Bright Dental");
    expect(brandCopy("so Talko can reply", PARTNER)).toBe("so Bright Dental can reply");
  });
  it("brandJson returns Talko's value itself, and rewrites strings deep inside for a partner", () => {
    const v = { a: ["Talko AI"], b: { c: "Talko handles it", d: 3 } };
    expect(brandJson(v, TALKO_BRAND)).toBe(v);
    expect(brandJson(v, PARTNER)).toEqual({ a: ["Bright Dental"], b: { c: "Bright Dental handles it", d: 3 } });
  });
});

describe("emails", () => {
  const opts: EmailOptions = {
    preheader: "Your Talko AI recap", heading: "Your week on Talko AI", paragraphs: ["Hello"],
    cta: { label: "Open your inbox", href: "/login" },
    secondary: { label: "Read the guide", href: "/guides/getting-started" },
    footerReason: "Because you own a Talko AI workspace.",
    unsubscribeHref: `${SITE_URL}/api/email/unsubscribe?t=abc.def`,
  };

  it("hands Talko's email back exactly as given", () => {
    const r = applyEmailBrand(TALKO_BRAND, opts, SITE_URL, "Subject on Talko AI");
    expect(r.opts).toBe(opts);
    expect(r.siteUrl).toBe(SITE_URL);
    expect(r.subject).toBe("Subject on Talko AI");
    expect(r.fromName).toBeUndefined();
  });

  it("renders Talko's footer and logo when no brand is given", () => {
    const { html, text } = renderEmail(opts, SITE_URL);
    expect(html).toContain("Talko AI by PM Technologies");
    expect(html).toContain("/brand/talko-logo.png");
    expect(text).toContain("Talko AI by PM Technologies");
  });

  it("gives a partner's customer the partner's name, logo and address, and no Talko links", () => {
    vi.stubEnv("WHITE_LABEL_ENABLED", "1");
    const r = applyEmailBrand(PARTNER, opts, SITE_URL, "Subject on Talko AI");
    const { html, text } = renderEmail(r.opts, r.siteUrl);
    expect(r.siteUrl).toBe("https://brightdental.thetalko.in");
    expect(r.subject).toBe("Subject on Bright Dental");
    expect(r.fromName).toBe("Bright Dental");
    expect(r.opts.secondary).toBeUndefined();                       // Talko's guides aren't on the partner's address
    expect(r.opts.unsubscribeHref).toBe("https://brightdental.thetalko.in/api/email/unsubscribe?t=abc.def");
    expect(html).toContain("https://cdn.example.com/bd.png");
    expect(html).toContain("https://brightdental.thetalko.in/login");
    for (const leak of ["Talko AI", "PM Technologies", "talko-logo", "/guides", "/status", "/contact"]) {
      expect(html + text).not.toContain(leak);
    }
    vi.unstubAllEnvs();
  });
});

describe("middleware", () => {
  // Every case states its own switch: nothing carries over between them.
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function hit(host: string, path: string, env: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    const { middleware } = await import("../../middleware");
    return middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  }
  const WL = { WHITE_LABEL_ENABLED: "1" };

  it("leaves a partner-shaped address alone while white-label is off", async () => {
    const r = await hit("brightdental.thetalko.in", "/login");
    expect(r.headers.get("x-middleware-rewrite")).toBeNull();
    expect(r.status).not.toBe(404);
  });

  it("never reroutes Talko's own app host, even with white-label on", async () => {
    const r = await hit("app.thetalko.in", "/login", WL);
    expect(r.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("sends a partner's /login to the branded sign-in page", async () => {
    const r = await hit("brightdental.thetalko.in", "/login", WL);
    expect(r.headers.get("x-middleware-rewrite")).toContain("/partner-login");
  });

  it("keeps Talko-only pages off a partner's address", async () => {
    for (const p of ["/admin/owner", "/admin/setup", "/support", "/affiliate", "/pricing", "/partner-login"]) {
      expect((await hit("brightdental.thetalko.in", p, WL)).status).toBe(404);
    }
  });

  it("sends a partner's front door, signup and billing to the portal", async () => {
    for (const p of ["/", "/signup", "/admin/billing"]) {
      const r = await hit("brightdental.thetalko.in", p, WL);
      expect(r.status).toBe(307);
      expect(new URL(r.headers.get("location")!).host).toBe("brightdental.thetalko.in");
    }
  });

  it("still serves APIs (webhooks, widget, login) on a partner's address", async () => {
    const r = await hit("brightdental.thetalko.in", "/api/widget/abc/loader.js", WL);
    expect(r.status).not.toBe(404);
  });
});
