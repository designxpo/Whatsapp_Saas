import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  admin: true, tenant: "tenant-a" as string | null,
  getSetting: vi.fn(), setSetting: vi.fn(), getSecret: vi.fn(), setSecret: vi.fn(), aiStatus: vi.fn(),
}));
vi.mock("../auth", () => ({ requireRoleAdmin: async () => h.admin, currentTenantId: async () => h.tenant }));
vi.mock("../store", () => ({ getTenantSetting: h.getSetting, setTenantSetting: h.setSetting, getTenantSecret: h.getSecret, setTenantSecret: h.setSecret }));
vi.mock("../ai/keys", () => ({ getTenantAiStatus: h.aiStatus }));
vi.mock("../voice", () => ({ VOICE_KEYS: { mode: "voice_reply_mode", openaiKey: "voice_openai_key" } }));
const { GET, POST, DELETE } = await import("../../app/api/admin/voice/route");
const request = (body: unknown) => new Request("https://app.example/api/admin/voice", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); h.admin = true; h.tenant = "tenant-a";
  h.getSetting.mockResolvedValue("mirror"); h.getSecret.mockResolvedValue(null);
  h.aiStatus.mockResolvedValue({ configured: true, provider: "gemini" });
});
describe("voice settings API", () => {
  it("refuses non-admins and missing tenant before touching settings", async () => {
    h.admin = false;
    for (const call of [() => GET(), () => POST(request({ mode: "always" })), () => DELETE()]) expect((await call()).status).toBe(403);
    h.admin = true; h.tenant = null;
    for (const call of [() => GET(), () => POST(request({ mode: "always" })), () => DELETE()]) expect((await call()).status).toBe(401);
    expect(h.getSetting).not.toHaveBeenCalled(); expect(h.setSecret).not.toHaveBeenCalled();
  });
  it("validates the entire body before any write", async () => {
    for (const body of [null, [], "text", { mode: "LOUD" }, { mode: 1 }, { openaiKey: 123 }, { openaiKey: {} }, { openaiKey: "x".repeat(1025) }, { mode: "invalid", openaiKey: "sk-test" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(h.setSetting).not.toHaveBeenCalled(); expect(h.setSecret).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON without writes", async () => {
    const res = await POST(new Request("https://app.example", { method: "POST", body: "{" }));
    expect(res.status).toBe(400); expect(h.setSetting).not.toHaveBeenCalled();
  });
  it("preserves the mode on a key-only save and a stored key on a blank save", async () => {
    expect((await POST(request({ openaiKey: " sk-test " }))).status).toBe(200);
    expect(h.setSecret).toHaveBeenCalledWith("tenant-a", "voice_openai_key", "sk-test");
    expect(h.setSetting).not.toHaveBeenCalled();
    h.setSecret.mockClear();
    expect((await POST(request({ mode: "mirror", openaiKey: "  " }))).status).toBe(200);
    expect(h.setSetting).toHaveBeenCalledWith("tenant-a", "voice_reply_mode", "mirror");
    expect(h.setSecret).not.toHaveBeenCalled();
  });
  it("reports actual key availability, not just a selected provider", async () => {
    h.aiStatus.mockResolvedValue({ configured: false, provider: "openai" });
    expect(await (await GET()).json()).toMatchObject({ providerIsOpenai: false, transcriptionAvailable: false, speechAvailable: false });
    h.aiStatus.mockResolvedValue({ configured: true, provider: "gemini" });
    expect(await (await GET()).json()).toMatchObject({ transcriptionAvailable: true, speechAvailable: false });
    h.getSecret.mockResolvedValue("sk-private-do-not-expose");
    const res = await GET();
    const body = await res.text();
    expect(body).not.toContain("sk-private");
    expect(JSON.parse(body)).toMatchObject({ keySet: true, speechAvailable: true });
  });
  it("does not expose secret-bearing storage errors", async () => {
    h.setSecret.mockRejectedValue(new Error("database error for sk-private"));
    const res = await POST(request({ mode: "always", openaiKey: "sk-private" }));
    expect(res.status).toBe(500); expect(await res.text()).not.toContain("sk-private");
    expect(h.setSetting).not.toHaveBeenCalled();
  });
  it("removes only the current tenant's dedicated key", async () => {
    expect((await DELETE()).status).toBe(200);
    expect(h.setSecret).toHaveBeenCalledWith("tenant-a", "voice_openai_key", "");
    expect(h.setSetting).not.toHaveBeenCalled();
  });
});
