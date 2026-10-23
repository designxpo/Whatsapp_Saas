// helmet()'s security headers, on a Next.js app.
//
// There is no Express app here to call app.use(helmet()) on, so next.config.ts
// sets the same headers itself — except where helmet's default would break a
// feature. Those exceptions are path rules, and a path rule nobody tests is
// how a popup silently stops reporting back or the chat widget stops loading
// on every customer site. So this resolves the real rules per path, the way
// Next does (each matching rule in order, the later value winning for the
// same header), and states what each kind of path ends up with.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import nextConfig from "../../../next.config";

const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};

async function headersFor(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rule of await nextConfig.headers!()) {
    if (pathToRegexp(rule.source).test(path)) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const HELMET = {
  "Strict-Transport-Security": /max-age=\d+/,
  "X-Content-Type-Options": /^nosniff$/,
  "X-Permitted-Cross-Domain-Policies": /^none$/,
  "Referrer-Policy": /./,
  "Origin-Agent-Cluster": /^\?1$/,
  "X-DNS-Prefetch-Control": /^off$/,
  "X-Download-Options": /^noopen$/,
  "X-XSS-Protection": /^0$/,
  "Content-Security-Policy": /object-src 'none'; base-uri 'self'/,
};

describe("helmet's headers", () => {
  it("are on every page, every API route and the embeddable pages alike", async () => {
    for (const p of ["/", "/admin", "/signup", "/blog/x", "/api/admin/contacts", "/api/widget/k/loader.js"]) {
      const h = await headersFor(p);
      for (const [k, re] of Object.entries(HELMET)) expect(h[k], `${p} ${k}`).toMatch(re);
    }
  });

  it("keeps frame protection everywhere", async () => {
    expect((await headersFor("/admin"))["Content-Security-Policy"]).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    expect((await headersFor("/admin"))["X-Frame-Options"]).toBe("DENY");
  });

  it("isolates pages from other windows but still lets them keep their own popups", async () => {
    // same-origin (helmet's default) cuts the Facebook SDK popup off from the page.
    expect((await headersFor("/admin"))["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });

  it("sends no opener policy on API routes — the Instagram popup's result page is one", async () => {
    // igpopup.ts reports back through window.opener; any COOP on it severs that.
    expect((await headersFor("/api/admin/onboarding/instagram/callback"))["Cross-Origin-Opener-Policy"]).toBeUndefined();
  });

  it("locks the signed-in APIs to this site, and nothing customer sites load", async () => {
    for (const p of ["/api/admin/contacts", "/api/owner/tenants"]) {
      expect((await headersFor(p))["Cross-Origin-Resource-Policy"], p).toBe("same-origin");
    }
    // The widget is a <script src> on customer websites; same-origin would block it there.
    for (const p of ["/api/widget/k/loader.js", "/api/widget/message", "/brand/logo.png", "/"]) {
      expect((await headersFor(p))["Cross-Origin-Resource-Policy"], p).toBeUndefined();
    }
  });
});
