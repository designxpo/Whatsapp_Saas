import { describe, it, expect, afterEach } from "vitest";
import { siteUrl, siteUrlUsable, trackingOrigin } from "../links";

// NEXT_PUBLIC_SITE_URL was found set to "https://your-deployed-url.vercel.app"
// in the live deployment — a copied placeholder nobody replaced. Harmless as a
// redirect fallback, but a template's URL button is approved by Meta ONCE and
// can't be edited, so baking that in would ship a permanently dead link to
// every recipient. siteUrlUsable() is the gate that stops it.
describe("siteUrlUsable — refuses to bake a non-public URL into an approved template", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original; });

  const check = (v: string | undefined) => {
    if (v === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = v;
    return siteUrlUsable();
  };

  it("accepts a real https domain", () => {
    expect(check("https://waba.analytixlabs.co.in")).toBe(true);
    expect(check("https://waba.analytixlabs.co.in/")).toBe(true);   // trailing slash trimmed
  });

  it("rejects the exact placeholder found in production", () => {
    expect(check("https://your-deployed-url.vercel.app")).toBe(false);
  });

  it("rejects the .env.example placeholder and friends", () => {
    expect(check("https://your-broadcaster.vercel.app")).toBe(false);
    expect(check("https://example.com")).toBe(false);
    expect(check("https://changeme.io")).toBe(false);
  });

  it("rejects localhost and the unset default", () => {
    expect(check("http://localhost:3000")).toBe(false);
    expect(check("http://127.0.0.1:3000")).toBe(false);
    expect(check(undefined)).toBe(false);   // falls back to the localhost default
  });

  it("rejects plain http on a real domain (Meta requires https for button URLs)", () => {
    expect(check("http://waba.analytixlabs.co.in")).toBe(false);
  });

  it("siteUrl itself still returns the raw configured value (callers that only need a fallback are unaffected)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://your-deployed-url.vercel.app/";
    expect(siteUrl()).toBe("https://your-deployed-url.vercel.app");
  });
});

// A placeholder env var shouldn't BLOCK anyone from enabling click tracking —
// the host the admin is submitting from is a perfectly good origin and can't
// itself be a placeholder. Refuse only when neither source is usable.
describe("trackingOrigin — what actually gets baked into an approved template", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original; });

  it("prefers a properly configured site URL over the request host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://waba.analytixlabs.co.in";
    expect(trackingOrigin("https://some-preview.vercel.app")).toBe("https://waba.analytixlabs.co.in");
  });

  it("falls back to the request host when the env var is the placeholder", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://your-deployed-url.vercel.app";
    expect(trackingOrigin("https://waba.analytixlabs.co.in")).toBe("https://waba.analytixlabs.co.in");
  });

  it("falls back to the request host when the env var is unset/localhost", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(trackingOrigin("https://waba.analytixlabs.co.in")).toBe("https://waba.analytixlabs.co.in");
  });

  it("trims a trailing slash off the request host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://your-deployed-url.vercel.app";
    expect(trackingOrigin("https://waba.analytixlabs.co.in/")).toBe("https://waba.analytixlabs.co.in");
  });

  it("returns null when NEITHER is usable — caller must refuse, not bake a dead link", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://your-deployed-url.vercel.app";
    expect(trackingOrigin("http://localhost:3000")).toBeNull();
    expect(trackingOrigin(null)).toBeNull();
    expect(trackingOrigin(undefined)).toBeNull();
    expect(trackingOrigin("")).toBeNull();
  });
});
