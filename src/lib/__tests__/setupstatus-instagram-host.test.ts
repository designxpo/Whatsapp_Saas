import { describe, it, expect, vi, afterEach } from "vitest";

// verifyInstagram used to call graph.facebook.com — but every Instagram
// channel this app creates is connected via Instagram API with Instagram
// Login (iglogin.ts, instagram.ts, the webhook route all target
// graph.instagram.com exclusively). A token from that flow is meaningless to
// graph.facebook.com, so a perfectly live, freshly-reconnected account was
// reported to the tenant as "invalid or expired" on the Setup Guide — Meta's
// error for the host mismatch reads identically to a real expired token.

const IG_CHANNEL = {
  id: "chan-1", tenantId: "tenant-1", kind: "instagram" as const,
  igUserId: "17841448671876634", token: "ig-login-token", isDefault: true, active: true,
  name: "@bolttaekwondoacademy",
};

vi.mock("../channels", () => ({
  listChannels: vi.fn(async () => [IG_CHANNEL]),
}));
vi.mock("../entitlements", () => ({
  getEntitlements: vi.fn(async () => null),
}));
vi.mock("../ai/keys", () => ({
  getTenantAiStatus: async () => ({ configured: false, provider: "gemini", model: "", keyHint: null }),
  resolveTenantAi: async () => { throw new Error("not used in this test"); },
  AiKeyMissingError: class AiKeyMissingError extends Error {},
}));
vi.mock("../ai/chat", () => ({ validateKey: async () => ({ ok: true }) }));
vi.mock("../store", () => ({ listDocuments: async () => [] }));
vi.mock("../leadsquared", () => ({ resolveLsq: async () => null }));
vi.mock("../integrations", () => ({ integrationsHealth: async () => ({}), listIntegrations: async () => [] }));
vi.mock("../plans", () => ({ getPlan: async () => null }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getSetupChecklist — Instagram verification host", () => {
  it("verifies the Instagram channel against graph.instagram.com, not graph.facebook.com", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("graph.facebook.com")) {
        return { ok: false, json: async () => ({ error: { code: 190, message: "Error validating access token" } }) } as Response;
      }
      if (String(url).includes("graph.instagram.com")) {
        return { ok: true, json: async () => ({ id: "17841448671876634", username: "bolttaekwondoacademy" }) } as Response;
      }
      throw new Error(`unexpected fetch host: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getSetupChecklist } = await import("../setupstatus");
    const { steps } = await getSetupChecklist("tenant-1");

    const igStep = steps.find(s => s.key === "instagram");
    expect(igStep).toBeDefined();

    const calledUrls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(calledUrls.some(u => u.includes("graph.instagram.com"))).toBe(true);
    expect(calledUrls.some(u => u.includes("graph.facebook.com"))).toBe(false);

    // The real assertion this bug broke: a live account must report ok, not
    // "invalid or expired" — which is exactly what calling the wrong host produced.
    expect(igStep!.status).toBe("ok");
    expect(igStep!.detail).toContain("bolttaekwondoacademy");
    expect(igStep!.detail).not.toMatch(/invalid or expired/i);
  });
});
