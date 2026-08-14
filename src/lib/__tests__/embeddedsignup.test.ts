import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exchangeSignupCode, subscribeWaba, registerPhone, resolveFacebookPages, exchangeForLongLivedToken } from "../embeddedsignup";
import { signupExtras, signupFailureMessage } from "../embedded-signup-client";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("embeddedsignup", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["META_APP_ID", "META_APP_SECRET"]) saved[k] = process.env[k];
    process.env.META_APP_ID = "test-app-id";
    process.env.META_APP_SECRET = "test-app-secret";
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    vi.unstubAllGlobals();
  });

  it("exchangeSignupCode fails loudly when the app env is missing", async () => {
    delete process.env.META_APP_SECRET;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not hit the network"); }));
    const r = await exchangeSignupCode("code123");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/META_APP_ID \/ META_APP_SECRET/);
  });

  it("exchangeSignupCode passes app creds + code and returns the token", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => res(200, { access_token: "biz-token" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await exchangeSignupCode("code123");
    expect(r).toEqual({ ok: true, token: "biz-token" });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toMatch(/\/oauth\/access_token$/);
    expect(url.searchParams.get("client_id")).toBe("test-app-id");
    expect(url.searchParams.get("client_secret")).toBe("test-app-secret");
    expect(url.searchParams.get("code")).toBe("code123");
  });

  it("exchangeSignupCode surfaces Meta's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(400, { error: { message: "This authorization code has expired." } })));
    const r = await exchangeSignupCode("stale");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired/);
  });

  it("subscribeWaba posts to /{wabaId}/subscribed_apps with the token", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => res(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await subscribeWaba("waba9", "tok")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/waba9\/subscribed_apps$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("subscribeWaba treats success:false and missing args as failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { success: false })));
    expect((await subscribeWaba("waba9", "tok")).ok).toBe(false);
    expect((await subscribeWaba("", "tok")).ok).toBe(false);
  });

  it("registerPhone reports Meta's rejection (the coexistence case)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(400, { error: { message: "Cannot register a coexistence number" } })));
    const r = await registerPhone("pn1", "tok");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/coexistence/);
  });

  it("signupExtras maps the variant to Meta's featureType", () => {
    expect(signupExtras("coex")).toEqual({ setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" });
    expect(signupExtras("new")).toEqual({ setup: {}, featureType: "", sessionInfoVersion: "3" });
  });

  // A no-code result used to be reported as "Sign-up was cancelled" whatever the
  // cause, which told a tenant they'd cancelled when in fact the operator's Meta
  // app had refused them ("It looks like this app isn't available"). The three
  // causes are distinguishable and must read differently.
  describe("signupFailureMessage", () => {
    it("prefers Meta's own error text over any guess of ours", () => {
      expect(signupFailureMessage(["ERROR"], "Number already registered"))
        .toBe("Meta stopped the sign-up: Number already registered");
    });

    it("calls it cancelled only when the flow had actually started", () => {
      const m = signupFailureMessage(["FLOW_STATUS_UPDATE", "CANCEL"]);
      expect(m).toMatch(/cancelled/i);
      expect(m).not.toMatch(/Development mode/);
    });

    it("blames the operator's Meta app when the popup emitted nothing at all", () => {
      const m = signupFailureMessage([]);
      expect(m).not.toMatch(/cancelled/i);
      expect(m).toMatch(/not anything you did/);
      expect(m).toMatch(/Development mode/);
      expect(m).toMatch(/Advanced Access/);
    });
  });

  it("resolveFacebookPages returns each Page with its own token", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => res(200, { data: [
      { id: "111", name: "My Shop", access_token: "page-tok-1" },
      { id: "222", name: "Side Page", access_token: "page-tok-2" },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await resolveFacebookPages("user-tok");
    expect(r.ok).toBe(true);
    expect(r.pages).toEqual([
      { id: "111", name: "My Shop", token: "page-tok-1" },
      { id: "222", name: "Side Page", token: "page-tok-2" },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/me\/accounts/);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-tok");
  });

  it("resolveFacebookPages drops Pages without a token and fails when none remain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { data: [{ id: "333", name: "No Token" }] })));
    const r = await resolveFacebookPages("user-tok");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No Facebook Page/);
  });

  it("resolveFacebookPages surfaces Meta's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(400, { error: { message: "Invalid OAuth access token." } })));
    const r = await resolveFacebookPages("bad");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid OAuth/);
  });

  it("exchangeForLongLivedToken sends grant_type=fb_exchange_token + app creds", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => res(200, { access_token: "long-tok" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await exchangeForLongLivedToken("short-tok");
    expect(r).toEqual({ ok: true, token: "long-tok" });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("client_id")).toBe("test-app-id");
    expect(url.searchParams.get("fb_exchange_token")).toBe("short-tok");
  });

  it("exchangeForLongLivedToken fails loudly when app creds are missing", async () => {
    delete process.env.META_APP_SECRET;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not hit the network"); }));
    const r = await exchangeForLongLivedToken("short-tok");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/META_APP_ID \/ META_APP_SECRET/);
  });
});
