import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the per-tenant AI layer + persistence/escalation so the auditor's CONTRACT
// is tested deterministically (no network, no DB).
const { runChat, resolveTenantAi, recordGroundingAudit, escalateConversation } = vi.hoisted(() => ({
  runChat: vi.fn(),
  resolveTenantAi: vi.fn(async () => ({ provider: "gemini", apiKey: "k", model: "test-model" })),
  recordGroundingAudit: vi.fn(async () => {}),
  escalateConversation: vi.fn(async () => {}),
}));
vi.mock("../ai/chat", () => ({ runChat }));
vi.mock("../ai/keys", () => ({ resolveTenantAi, AiKeyMissingError: class extends Error {} }));
vi.mock("../store", () => ({ recordGroundingAudit, escalateConversation }));
vi.mock("../tenant", () => ({ DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000001" }));

import { auditReply } from "../guard/audit";

const verdict = (o: Record<string, unknown>) => runChat.mockResolvedValue({ text: JSON.stringify(o), toolCalls: [] });
const LONG_REPLY = "It is a 3.5-4 month weekend program and the fee is great value for everything covered.";

describe("auditReply — SaaS grounding auditor contract", () => {
  beforeEach(() => { runChat.mockReset(); resolveTenantAi.mockClear(); recordGroundingAudit.mockReset(); escalateConversation.mockReset(); resolveTenantAi.mockResolvedValue({ provider: "gemini", apiKey: "k", model: "test-model" }); });

  it("active mode flags + escalates + blocks cache on a confident hallucination", async () => {
    process.env.GROUNDING_AUDIT = "active";
    verdict({ grounded: false, unsupportedClaims: ["3.5-4 months"], droppedSubquestions: [], confidence: 0.9 });
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "duration and fees?", reply: LONG_REPLY, context: "" });
    expect(v).toMatchObject({ grounded: false, shouldCache: false });
    expect(escalateConversation).toHaveBeenCalledWith("c1");
    expect(recordGroundingAudit).toHaveBeenCalledTimes(1);
  });

  it("tolerates a code-fenced JSON verdict", async () => {
    process.env.GROUNDING_AUDIT = "active";
    runChat.mockResolvedValue({ text: "```json\n{\"grounded\": true, \"confidence\": 0.9}\n```", toolCalls: [] });
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "duration?", reply: "The course runs for six months as per the brochure provided.", context: "[1] six-month" });
    expect(v).toMatchObject({ grounded: true, shouldCache: true });
    expect(escalateConversation).not.toHaveBeenCalled();
  });

  it("shadow mode records but never escalates or gates the cache", async () => {
    process.env.GROUNDING_AUDIT = "shadow";
    verdict({ grounded: false, confidence: 0.95 });
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "fees?", reply: "The fee is exactly 99,999 rupees for this comprehensive program.", context: "" });
    expect(v?.shouldCache).toBe(true);
    expect(escalateConversation).not.toHaveBeenCalled();
    expect(recordGroundingAudit).toHaveBeenCalledTimes(1);
  });

  it("off mode skips entirely — no model call", async () => {
    process.env.GROUNDING_AUDIT = "off";
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "fees?", reply: LONG_REPLY, context: "" });
    expect(v).toBeNull();
    expect(runChat).not.toHaveBeenCalled();
  });

  it("fails open when the tenant has no AI key", async () => {
    process.env.GROUNDING_AUDIT = "active";
    resolveTenantAi.mockRejectedValue(new Error("no key"));
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "fees?", reply: LONG_REPLY, context: "" });
    expect(v).toBeNull();
    expect(escalateConversation).not.toHaveBeenCalled();
  });

  it("low-confidence negative does NOT flag", async () => {
    process.env.GROUNDING_AUDIT = "active";
    verdict({ grounded: false, confidence: 0.3 });
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "fees?", reply: LONG_REPLY, context: "" });
    expect(v).toMatchObject({ grounded: true, shouldCache: true });
    expect(escalateConversation).not.toHaveBeenCalled();
  });

  it("skips trivial short replies without a model call", async () => {
    process.env.GROUNDING_AUDIT = "active";
    const v = await auditReply({ tenantId: "t1", conversationId: "c1", question: "hi", reply: "Hi! 👋", context: "" });
    expect(v).toBeNull();
    expect(runChat).not.toHaveBeenCalled();
  });
});
