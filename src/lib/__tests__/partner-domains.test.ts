// White-label, Phase 6: partners' own domains and the shared-quota cap.
// Talko's own hosts must never be taken for a partner's domain, and a
// partner's address must follow its verified domain.
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isTalkoHost, partnerHostKind, brandOrigin, brandFromPartner } from "../whitelabel";
import { checkPortalDomain } from "../partner-domains";
import { partnerYtRemaining } from "../partner-quotas";

const ON = { enabled: true, baseDomain: "thetalko.in" };

describe("which hosts are Talko's", () => {
  it("keeps the base domain, its sub-addresses, previews and localhost as Talko", () => {
    for (const h of ["thetalko.in", "www.thetalko.in", "app.thetalko.in", "brightdental.thetalko.in", "x.vercel.app", "localhost:3000", "127.0.0.1"]) {
      expect(isTalkoHost(h, ON, {})).toBe(true);
    }
  });
  it("counts the configured app and marketing hosts as Talko's", () => {
    expect(isTalkoHost("talko.example.com", ON, { NEXT_PUBLIC_APP_HOST: "talko.example.com" })).toBe(true);
    expect(isTalkoHost("extra.example.org", ON, { TALKO_EXTRA_HOSTS: "a.b.com, extra.example.org" })).toBe(true);
  });
  it("sees any other host as a possible partner domain, only with white-label on", () => {
    expect(partnerHostKind("portal.brightdental.in", ON)).toEqual({ domain: "portal.brightdental.in" });
    expect(partnerHostKind("portal.brightdental.in", { ...ON, enabled: false })).toBeNull();
    expect(partnerHostKind("brightdental.thetalko.in", ON)).toEqual({ slug: "brightdental" });
  });
});

describe("portal domains", () => {
  it("accepts a partner's own subdomain and refuses Talko's or a bare domain", () => {
    expect(checkPortalDomain("https://Portal.BrightDental.in/")).toEqual({ ok: true, domain: "portal.brightdental.in" });
    expect(checkPortalDomain("brightdental.in").ok).toBe(false);          // would take over their main website
    expect(checkPortalDomain("portal.thetalko.in").ok).toBe(false);
    expect(checkPortalDomain("not a domain").ok).toBe(false);
  });
  it("uses the domain only once it's verified, and the sending address likewise", () => {
    const base = { id: "p1", slug: "bd", name: "BD", tier: "pro", customDomain: "portal.bd.in", emailDomain: { name: "bd.in", status: "pending" } };
    expect(brandFromPartner({ ...base, domainStatus: "pending" }).domain).toBeNull();
    const live = brandFromPartner({ ...base, domainStatus: "verified", emailDomain: { name: "bd.in", status: "verified" } });
    expect(live.domain).toBe("portal.bd.in");
    expect(live.emailFrom).toBe("no-reply@bd.in");
    expect(brandOrigin(live, ON)).toBe("https://portal.bd.in");
    expect(brandOrigin({ slug: "bd", domain: null }, ON)).toBe("https://bd.thetalko.in");
  });
});

describe("routing on a partner's own domain", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  async function hit(host: string, path: string) {
    vi.stubEnv("WHITE_LABEL_ENABLED", "1");
    vi.resetModules();
    const { middleware } = await import("../../middleware");
    return middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  }
  it("serves the branded sign-in and keeps Talko's pages off it", async () => {
    expect((await hit("portal.brightdental.in", "/login")).headers.get("x-middleware-rewrite")).toContain("/partner-login");
    expect((await hit("portal.brightdental.in", "/pricing")).status).toBe(404);
    expect((await hit("portal.brightdental.in", "/admin/owner")).status).toBe(404);
  });
  it("leaves Vercel preview hosts as Talko", async () => {
    expect((await hit("talko-git-x.vercel.app", "/login")).headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("shared YouTube quota", () => {
  it("adds no limit and reads nothing while white-label is off", async () => {
    expect(await partnerYtRemaining("t1")).toBe(Number.POSITIVE_INFINITY);
  });
});
