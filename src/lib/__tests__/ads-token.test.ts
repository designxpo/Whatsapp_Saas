import { describe, it, expect, vi, beforeEach } from "vitest";

// Whose Meta token signs a tenant's ad calls.
//
// The ad ACCOUNT was per-tenant from the start; the TOKEN was one shared env
// var. So every tenant's Marketing API calls went out signed by the platform
// operator's system user, which has no role on the tenant's ad account, and Meta
// answered — correctly — "(#200) Ad account owner has NOT grant ads_management
// or ads_read permission". No work inside the tenant's own Business Manager
// could fix that, because the token was never theirs.

const secrets = new Map<string, string>();
vi.mock("../store", () => ({
  getTenantSetting: async (_t: string, _k: string, d: unknown) => d,
  setTenantSetting: async () => {},
  getTenantSecret: async (t: string, k: string) => secrets.get(`${t}:${k}`) ?? null,
  setTenantSecret: async (t: string, k: string, v: string) => { secrets.set(`${t}:${k}`, v); },
}));
vi.mock("../supabase", () => ({ db: () => ({}) }));

import { getAdsToken, setAdsToken, getAdsTokenStatus } from "../ads";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("ads token — per workspace, env only as the fallback", () => {
  beforeEach(() => {
    secrets.clear();
    delete process.env.META_ADS_ACCESS_TOKEN;
    delete process.env.META_WA_ACCESS_TOKEN;
  });

  it("uses the workspace's own token when it has one", async () => {
    await setAdsToken("tenant-a-token", A);
    expect(await getAdsToken(A)).toBe("tenant-a-token");
  });

  it("keeps two workspaces on their own tokens", async () => {
    await setAdsToken("tenant-a-token", A);
    await setAdsToken("tenant-b-token", B);
    expect(await getAdsToken(A)).toBe("tenant-a-token");
    expect(await getAdsToken(B)).toBe("tenant-b-token");
  });

  // The regression that caused the reported (#200): a tenant with their own
  // token must never be signed with the platform's.
  it("prefers the workspace token over the platform env token", async () => {
    process.env.META_ADS_ACCESS_TOKEN = "platform-token";
    await setAdsToken("tenant-a-token", A);
    expect(await getAdsToken(A)).toBe("tenant-a-token");
  });

  // Single-tenant deployments and the operator's own account run entirely on
  // env today — that must keep working untouched.
  it("falls back to the platform env token for a workspace with none", async () => {
    process.env.META_ADS_ACCESS_TOKEN = "platform-token";
    expect(await getAdsToken(B)).toBe("platform-token");
  });

  it("falls back to the WhatsApp system-user token last", async () => {
    process.env.META_WA_ACCESS_TOKEN = "wa-token";
    expect(await getAdsToken(B)).toBe("wa-token");
  });

  it("returns nothing when neither exists, so callers can say so plainly", async () => {
    expect(await getAdsToken(B)).toBeUndefined();
  });

  it("treats a cleared token as absent rather than as an empty token", async () => {
    process.env.META_ADS_ACCESS_TOKEN = "platform-token";
    await setAdsToken("tenant-a-token", A);
    await setAdsToken("   ", A);
    expect(await getAdsToken(A)).toBe("platform-token");
  });

  describe("status for the setup wizard", () => {
    it("distinguishes an own token from the env fallback, and never leaks it", async () => {
      process.env.META_ADS_ACCESS_TOKEN = "platform-token";
      expect(await getAdsTokenStatus(B)).toEqual({ own: false, hint: null });

      await setAdsToken("EAAGabcdefghijklmnop1234", A);
      const st = await getAdsTokenStatus(A);
      expect(st.own).toBe(true);
      expect(st.hint).toBe("EAAGab…1234");
      expect(st.hint).not.toContain("efghijklmnop");
    });
  });
});
