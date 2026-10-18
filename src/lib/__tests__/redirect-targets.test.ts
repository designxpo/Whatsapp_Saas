// Three public routes 302 to a URL read out of the database.
//
// Today those targets are set by an admin of the one business on the platform.
// With self-serve signup, anyone with a WhatsApp number and two minutes becomes
// an admin — and gets a redirector on the production domain, which is the
// domain every WhatsApp template links to. The cost of that being abused is not
// one bad link; it is the domain's reputation, and a domain flagged by Safe
// Browsing or by Meta takes template delivery with it.
//
// So the question these tests ask is not "does the redirect work". It is "what
// is the worst thing that can come out of the database and still be followed".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeRedirectTarget } from "../links";

describe("what may be redirected to", () => {
  it("allows ordinary web links", () => {
    expect(safeRedirectTarget("https://example.com/page?a=1")).toBe("https://example.com/page?a=1");
    // http is allowed alongside https: existing customer links use it, and
    // breaking them silently is worse than the downgrade.
    expect(safeRedirectTarget("http://example.com/")).toBe("http://example.com/");
    expect(safeRedirectTarget("https://wa.me/919876543210?text=hi")).toContain("wa.me");
  });

  it("refuses script-bearing schemes", () => {
    // Browsers mostly ignore these in a Location header — but "mostly,
    // probably" is not a control, and the same stored value is rendered as an
    // href elsewhere, where javascript: does run.
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "jAvAsCrIpT:alert(1)",
      "  javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "intent://evil#Intent;scheme=http;end",
    ]) {
      expect(safeRedirectTarget(bad), bad).toBeNull();
    }
  });

  it("refuses anything that is not an absolute URL", () => {
    for (const bad of ["", "   ", "/admin", "example.com", "//evil.test", "not a url", null, undefined]) {
      expect(safeRedirectTarget(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it("is an allowlist, so a scheme nobody has thought of is refused", () => {
    // The point of the shape, not of any one example: a denylist would need
    // updating every time a new scheme appears.
    expect(safeRedirectTarget("chrome://settings")).toBeNull();
    expect(safeRedirectTarget("ws://example.com")).toBeNull();
    expect(safeRedirectTarget("mailto:a@b.com")).toBeNull();
  });
});

describe("the routes actually apply it", () => {
  beforeEach(() => { vi.resetModules(); });

  it("/g/<slug> treats a script target exactly like a missing link", async () => {
    // Not an error page that says "blocked" — a visitor should learn nothing,
    // and the link simply does not work.
    vi.doMock("@/lib/growth", () => ({ resolveGrowthRedirect: async () => "javascript:alert(1)" }));
    const { GET } = await import("../../app/g/[slug]/route");
    const res = await GET(new Request("https://x.test/g/abc"), { params: Promise.resolve({ slug: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("/g/<slug> still follows a real link", async () => {
    // The control: a guard that refused everything would pass the test above
    // while breaking every growth link in production.
    vi.doMock("@/lib/growth", () => ({ resolveGrowthRedirect: async () => "https://wa.me/919876543210" }));
    const { GET } = await import("../../app/g/[slug]/route");
    const res = await GET(new Request("https://x.test/g/abc"), { params: Promise.resolve({ slug: "abc" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://wa.me/919876543210");
  });

  it("/r/<code> falls back to the site rather than following a script target", async () => {
    vi.doMock("@/lib/links", async (orig) => ({
      ...(await orig<typeof import("../links")>()),
      registerClick: async () => "javascript:alert(1)",
    }));
    process.env.NEXT_PUBLIC_SITE_URL = "https://portal.example";
    const { GET } = await import("../../app/r/[code]/route");
    const res = await GET(new Request("https://x.test/r/abc"), { params: Promise.resolve({ code: "abc" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("portal.example");
    expect(res.headers.get("location")).not.toContain("javascript");
  });

  it("/r/<code> still follows a real target", async () => {
    vi.doMock("@/lib/links", async (orig) => ({
      ...(await orig<typeof import("../links")>()),
      registerClick: async () => "https://customer.example/offer",
    }));
    const { GET } = await import("../../app/r/[code]/route");
    const res = await GET(new Request("https://x.test/r/abc"), { params: Promise.resolve({ code: "abc" }) });
    expect(res.headers.get("location")).toBe("https://customer.example/offer");
  });
});
