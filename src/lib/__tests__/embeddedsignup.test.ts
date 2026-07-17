import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exchangeSignupCode, subscribeWaba, registerPhone } from "../embeddedsignup";
import { signupExtras } from "../embedded-signup-client";

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
});
