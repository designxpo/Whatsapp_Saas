import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Business Login for Instagram — the connect flow for the Instagram API this app
// is actually approved for. It is a different Meta product from Facebook Login
// for Business: different app id, different secret, different endpoints, and a
// permission family (instagram_business_*) that cannot even be selected in a
// Facebook Login configuration. Getting any of that wrong fails silently — Meta
// still shows the tenant a success screen — so the wiring is pinned here.

const ENV = { ...process.env };
beforeEach(() => {
  process.env.META_INSTAGRAM_APP_ID = "1355414803224410";
  process.env.META_INSTAGRAM_APP_SECRET = "s3cr3t-app-secret";
  process.env.ADMIN_JWT_SECRET = "test-signing-secret-at-least-32-chars-long";
  delete process.env.META_INSTAGRAM_REDIRECT_URI;
  vi.resetModules();
});
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); });

const load = () => import("../iglogin");
const T = "11111111-1111-1111-1111-111111111111";

describe("authorize URL", () => {
  it("points at instagram.com, not facebook.com", async () => {
    const { igAuthorizeUrl } = await load();
    const u = new URL(igAuthorizeUrl("https://app.thetalko.in/cb", "st"));
    expect(u.origin).toBe("https://www.instagram.com");
    expect(u.pathname).toBe("/oauth/authorize");
  });

  it("uses the Instagram app id, which is NOT the Facebook app id", async () => {
    const { igAuthorizeUrl } = await load();
    const u = new URL(igAuthorizeUrl("https://app.thetalko.in/cb", "st"));
    expect(u.searchParams.get("client_id")).toBe("1355414803224410");
    expect(u.searchParams.get("client_id")).not.toBe("2543832302713267");
  });

  it("asks only for instagram_business_* scopes", async () => {
    const { igAuthorizeUrl } = await load();
    const scopes = new URL(igAuthorizeUrl("https://app.thetalko.in/cb", "st")).searchParams.get("scope")!.split(",");
    expect(scopes).toContain("instagram_business_basic");
    expect(scopes).toContain("instagram_business_manage_messages");
    // The Facebook-Login family would be rejected here — it belongs to the other product.
    expect(scopes.every(s => s.startsWith("instagram_business_"))).toBe(true);
  });

  it("lets a scope be dropped by env without a deploy, since an unapproved one kills the whole authorize", async () => {
    process.env.META_INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_manage_messages";
    vi.resetModules();
    const { igAuthorizeUrl } = await load();
    expect(new URL(igAuthorizeUrl("https://x/cb", "st")).searchParams.get("scope"))
      .toBe("instagram_business_basic,instagram_business_manage_messages");
  });
});

describe("redirect URI", () => {
  it("derives from the request origin so preview deployments work", async () => {
    const { igRedirectUri } = await load();
    expect(igRedirectUri("https://app.thetalko.in/api/admin/onboarding/instagram/start"))
      .toBe("https://app.thetalko.in/api/admin/onboarding/instagram/callback");
  });

  // Meta matches the whitelist byte-for-byte, so a proxy that rewrites the host
  // has to be able to pin it.
  it("an explicit env value wins", async () => {
    process.env.META_INSTAGRAM_REDIRECT_URI = "https://app.thetalko.in/api/admin/onboarding/instagram/callback";
    vi.resetModules();
    const { igRedirectUri } = await load();
    expect(igRedirectUri("https://preview.vercel.app/whatever")).toBe("https://app.thetalko.in/api/admin/onboarding/instagram/callback");
  });
});

describe("readiness", () => {
  it("names exactly what's missing", async () => {
    delete process.env.META_INSTAGRAM_APP_ID;
    vi.resetModules();
    const { igLoginReady, igLoginMissing } = await load();
    expect(igLoginReady()).toBe(false);
    expect(igLoginMissing()).toEqual(["META_INSTAGRAM_APP_ID"]);
  });
});

// The callback runs in the admin's own authenticated session, so without a bound
// state an attacker could hand a victim admin a callback URL carrying the
// ATTACKER's code and silently attach their Instagram account to the victim's
// workspace.
describe("CSRF state", () => {
  it("round-trips for the workspace that issued it", async () => {
    const { signState, verifyState } = await load();
    const now = 1_700_000_000_000;
    expect(verifyState(signState(T, now), T, now + 1000)).toEqual({ ok: true });
  });

  it("rejects a state issued for another workspace", async () => {
    const { signState, verifyState } = await load();
    const now = 1_700_000_000_000;
    expect(verifyState(signState("22222222-2222-2222-2222-222222222222", now), T, now).ok).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const { signState, verifyState } = await load();
    const now = 1_700_000_000_000;
    const [body] = signState(T, now).split(".");
    expect(verifyState(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, T, now).ok).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const { signState, verifyState } = await load();
    const now = 1_700_000_000_000;
    const [, sig] = signState(T, now).split(".");
    const forged = Buffer.from(`${T}.${now}`).toString("base64url");
    expect(verifyState(`${forged}x.${sig}`, T, now).ok).toBe(false);
  });

  it("expires", async () => {
    const { signState, verifyState } = await load();
    const now = 1_700_000_000_000;
    expect(verifyState(signState(T, now), T, now + 11 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a state minted in the future", async () => {
    const { signState, verifyState } = await load();
    const now = 1_700_000_000_000;
    expect(verifyState(signState(T, now + 5 * 60_000), T, now).ok).toBe(false);
  });

  it("rejects garbage without throwing", async () => {
    const { verifyState } = await load();
    for (const bad of ["", "x", "a.b.c", "!!!.???"]) expect(verifyState(bad, T, Date.now()).ok).toBe(false);
  });
});

describe("code exchange", () => {
  it("posts to api.instagram.com with the Instagram credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "IGQ-short", user_id: 178414, permissions: "instagram_business_basic" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { exchangeIgCode } = await load();
    const r = await exchangeIgCode("thecode", "https://app.thetalko.in/cb");
    expect(r).toMatchObject({ ok: true, token: "IGQ-short", userId: "178414", permissions: ["instagram_business_basic"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.instagram.com/oauth/access_token");
    expect(String(init.body)).toContain("client_id=1355414803224410");
    expect(String(init.body)).toContain("grant_type=authorization_code");
  });

  // Instagram appends "#_" to the code in the browser fragment; passing it
  // through makes the exchange fail with an opaque error.
  it("strips Instagram's trailing #_ from the code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "t" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { exchangeIgCode } = await load();
    await exchangeIgCode("abc123#_", "https://app.thetalko.in/cb");
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get("code")).toBe("abc123");
  });

  it("surfaces Instagram's own error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error_message: "Invalid platform app" }) }));
    const { exchangeIgCode } = await load();
    expect(await exchangeIgCode("c", "https://x/cb")).toEqual({ ok: false, error: "Invalid platform app" });
  });

  it("refuses to call Meta when unconfigured", async () => {
    delete process.env.META_INSTAGRAM_APP_ID;
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { exchangeIgCode } = await load();
    expect((await exchangeIgCode("c", "https://x/cb")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("long-lived exchange", () => {
  // The short token dies within the hour — storing it would give every tenant a
  // channel that stops working the same afternoon.
  it("upgrades on graph.instagram.com with ig_exchange_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "IGQ-long", expires_in: 5183944 }) });
    vi.stubGlobal("fetch", fetchMock);
    const { igLongLivedToken } = await load();
    // expires_in is carried through now — the refresh sweep reports how much
    // life a renewed token has, and Meta's own number is the only honest source.
    expect(await igLongLivedToken("IGQ-short")).toEqual({ ok: true, token: "IGQ-long", expiresIn: 5183944 });
    const u = new URL(String(fetchMock.mock.calls[0][0]));
    expect(u.origin).toBe("https://graph.instagram.com");
    expect(u.searchParams.get("grant_type")).toBe("ig_exchange_token");
  });

  it("reports failure rather than returning the short token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "bad token" } }) }));
    const { igLongLivedToken } = await load();
    expect(await igLongLivedToken("short")).toEqual({ ok: false, error: "bad token" });
  });
});
