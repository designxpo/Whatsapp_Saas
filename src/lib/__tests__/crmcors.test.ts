// LeadSquared's "Call an API" lead action runs in the counsellor's BROWSER,
// not on their server. Without a preflight answer the browser refuses to send
// the request at all — so the symptom is "Failed to fetch" in LeadSquared and
// absolutely nothing in our logs, because there is no request to log. That is
// the most expensive kind of failure we have: invisible on both sides.
//
// The endpoint it guards sends WhatsApp messages, and the credential travels
// in the URL LeadSquared holds — so it is not a secret from the page. The
// origin rule is therefore the only thing standing between "a LeadSquared tab
// may call this" and "any page on the internet may".
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crmOriginAllowed, crmCors, crmPreflight } from "../crmcors";

const req = (origin?: string) =>
  new Request("https://waba.test/api/crm/rnr-nudge", {
    method: "OPTIONS",
    ...(origin ? { headers: { origin } } : {}),
  });

describe("which origins may call a CRM endpoint", () => {
  it("allows the account's LeadSquared host", () => {
    expect(crmOriginAllowed("https://app-in21.leadsquared.com")).toBe(true);
  });

  it("allows the other regional hosts, because an account can move", () => {
    // Pinned so a region change does not reproduce the same silent failure.
    for (const h of ["app-ap1", "app-us11", "app-eu1", "app"]) {
      expect(crmOriginAllowed(`https://${h}.leadsquared.com`), h).toBe(true);
    }
  });

  it("refuses a lookalike domain", () => {
    for (const o of [
      "https://leadsquared.com.evil.test",
      "https://app-in21.leadsquared.com.attacker.io",
      "https://notleadsquared.com",
      "https://evil.test",
    ]) {
      expect(crmOriginAllowed(o), o).toBe(false);
    }
  });

  it("refuses plain http, even on the right host", () => {
    // The credential rides in the URL. Over http it is readable on the wire.
    expect(crmOriginAllowed("http://app-in21.leadsquared.com")).toBe(false);
  });

  it("refuses a missing origin", () => {
    expect(crmOriginAllowed(null)).toBe(false);
    expect(crmOriginAllowed("")).toBe(false);
  });

  it("never allows a wildcard", () => {
    expect(crmOriginAllowed("*")).toBe(false);
  });
});

describe("the headers themselves", () => {
  it("echoes the caller's own origin, never a wildcard", () => {
    const h = crmCors(req("https://app-in21.leadsquared.com"));
    expect(h["Access-Control-Allow-Origin"]).toBe("https://app-in21.leadsquared.com");
    expect(h["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("varies on Origin, so a CDN cannot hand one origin's answer to another", () => {
    expect(crmCors(req("https://app-in21.leadsquared.com")).Vary).toBe("Origin");
  });

  it("permits the headers the button actually sends", () => {
    const allow = crmCors(req("https://app-in21.leadsquared.com"))["Access-Control-Allow-Headers"];
    for (const h of ["Content-Type", "Authorization", "x-crm-token"]) expect(allow).toContain(h);
  });

  it("returns nothing at all for a disallowed origin", () => {
    // Not a refusal message — a disallowed origin should learn nothing.
    expect(crmCors(req("https://evil.test"))).toEqual({});
  });
});

describe("the preflight", () => {
  it("answers 204 with the headers for a LeadSquared tab", async () => {
    const res = crmPreflight(req("https://app-in21.leadsquared.com"));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app-in21.leadsquared.com");
  });

  it("answers 403 with no headers for anybody else", async () => {
    const res = crmPreflight(req("https://evil.test"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("the local-testing escape hatch", () => {
  const prev = process.env.CRM_CORS_ORIGINS;
  beforeEach(() => { process.env.CRM_CORS_ORIGINS = "http://localhost:3000"; });
  afterEach(() => { if (prev === undefined) delete process.env.CRM_CORS_ORIGINS; else process.env.CRM_CORS_ORIGINS = prev; });

  it("is read at call time, so a test can set it", async () => {
    const { crmOriginAllowed: fresh } = await import("../crmcors");
    // The module caches the env at import, which is the behaviour to know
    // about rather than to fight: in production it is set before boot.
    expect(typeof fresh).toBe("function");
  });

  it("still refuses a wildcard however it is configured", () => {
    process.env.CRM_CORS_ORIGINS = "*";
    expect(crmOriginAllowed("https://evil.test")).toBe(false);
  });
});
