import { describe, it, expect, vi, beforeEach } from "vitest";

// composeFollowup is the AI nudge generator behind the "follow up when a lead goes
// quiet" feature. Its CONTRACT: produce ONE short re-engagement line via the
// tenant's chat provider, run it through the SAME grounding firewall as a live
// reply (so a nudge can never invent a price / email / link), and fail safe (return
// null) when the model is empty, errors, or the tenant has no AI key.
// vi.mock is hoisted, so the mocked AI layer comes from vi.hoisted.
const { runChat, resolveTenantAi } = vi.hoisted(() => ({
  runChat: vi.fn(),
  resolveTenantAi: vi.fn(async () => ({ provider: "gemini", apiKey: "k", model: "test-model" })),
}));
vi.mock("../ai/chat", () => ({ runChat, providerSupportsMedia: () => true }));
vi.mock("../ai/keys", () => ({ resolveTenantAi, AiKeyMissingError: class extends Error {} }));

import { composeFollowup } from "../llm";

const TRANSCRIPT = [
  { role: "user" as const, body: "Tell me about the Data Science course" },
  { role: "assistant" as const, body: "It's a hands-on program. Which background are you coming from?" },
];

describe("composeFollowup — quiet-lead re-engagement nudge (SaaS, per-tenant)", () => {
  beforeEach(() => {
    runChat.mockReset();
    resolveTenantAi.mockClear();
    resolveTenantAi.mockResolvedValue({ provider: "gemini", apiKey: "k", model: "test-model" });
  });

  it("returns the model's nudge text, composed with the tenant's provider", async () => {
    runChat.mockResolvedValue({ text: "Just checking in — happy to share more about the Data Science course whenever you're ready!", toolCalls: [] });
    const r = await composeFollowup(TRANSCRIPT, { tenantId: "11111111-1111-1111-1111-111111111111" });
    expect(r?.text).toContain("Data Science");
    expect(resolveTenantAi).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(runChat).toHaveBeenCalledTimes(1);
  });

  it("strips wrapping quotes the model sometimes adds", async () => {
    runChat.mockResolvedValue({ text: '"Did you still want details on the course?"', toolCalls: [] });
    const r = await composeFollowup(TRANSCRIPT);
    expect(r?.text).toBe("Did you still want details on the course?");
  });

  it("grounding firewall removes an invented fee that isn't in the transcript", async () => {
    runChat.mockResolvedValue({ text: "Just following up! The course fee is ₹49,999 — want me to enroll you?", toolCalls: [] });
    const r = await composeFollowup(TRANSCRIPT);
    expect(r?.text ?? "").not.toContain("49,999");
  });

  it("returns null when the model produces nothing usable", async () => {
    runChat.mockResolvedValue({ text: "   ", toolCalls: [] });
    const r = await composeFollowup(TRANSCRIPT);
    expect(r).toBeNull();
  });

  it("returns null when the tenant has no AI key (never throws into the cron)", async () => {
    resolveTenantAi.mockRejectedValue(new Error("no key"));
    const r = await composeFollowup(TRANSCRIPT);
    expect(r).toBeNull();
    expect(runChat).not.toHaveBeenCalled();
  });

  it("returns null for an empty transcript (nothing to follow up on)", async () => {
    const r = await composeFollowup([]);
    expect(r).toBeNull();
    expect(runChat).not.toHaveBeenCalled();
  });
});
