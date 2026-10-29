// Business isolation: a workspace running several businesses must never answer
// one business's customer with another business's persona or documents.
//
// It happened (Oct 2026): the product's own website chat had no persona pinned,
// fell back to the workspace's "active" persona — a spiritual channel's — and
// answered a stranger's exam paper. These tests hold the fallbacks shut.
import { describe, it, expect, vi } from "vitest";
import { isolationActive, channelIssues, NEUTRAL_AGENT } from "../isolation";

describe("isolationActive", () => {
  const ch = (agentId: string | null, kbTag: string | null) => ({ agentId, kbTag });

  it("leaves a one-business workspace alone, even with several personas", () => {
    // Sales + Support on one brand, nothing pinned, auto-routing between them.
    expect(isolationActive("auto", [ch(null, null), ch(null, null)])).toBe(false);
    expect(isolationActive("auto", [ch("a", "shop"), ch("a", "shop")])).toBe(false);
    expect(isolationActive("auto", [])).toBe(false);
  });

  it("turns on once channels are split into two knowledge bases", () => {
    expect(isolationActive("auto", [ch(null, "website"), ch(null, "spiritual")])).toBe(true);
  });

  it("turns on once channels pin two different personas", () => {
    expect(isolationActive("auto", [ch("talko", null), ch("spiritual", null)])).toBe(true);
  });

  it("obeys the owner's override both ways", () => {
    expect(isolationActive("on", [])).toBe(true);
    expect(isolationActive("off", [ch("a", "x"), ch("b", "y")])).toBe(false);
  });
});

describe("channelIssues", () => {
  const ids = new Set(["talko"]);
  const base = { id: "c", name: "Website", kind: "webchat" };

  it("flags a channel with no persona and no knowledge", () => {
    expect(channelIssues({ ...base, agentId: null, kbTag: null }, ids).map(i => i.code)).toEqual(["no-persona", "no-knowledge"]);
  });

  it("flags a pinned persona that was deleted", () => {
    expect(channelIssues({ ...base, agentId: "gone", kbTag: "website" }, ids).map(i => i.code)).toEqual(["persona-missing"]);
  });

  it("is quiet for a fully set channel", () => {
    expect(channelIssues({ ...base, agentId: "talko", kbTag: "website" }, ids)).toEqual([]);
  });
});

// The reply path itself, reached the way a channel reaches it.
describe("generateReply in a partitioned workspace", () => {
  async function run(agentId: string | null, scope: { tag: string | null; strict: boolean } | null, pinned: { id: string; name: string } | null = null) {
    vi.resetModules();
    const prompts: string[] = [];
    const retrieve = vi.fn(async () => [] as { content: string; similarity: number }[]);
    const resolveAgent = vi.fn(async () => ({ id: "sp", name: "Spiritual Talks", persona: "SPIRITUAL PERSONA answer anything", constraintsText: "", productInfo: "", model: null, active: true }));
    vi.doMock("../isolation", async (orig) => ({ ...(await orig<typeof import("../isolation")>()), getIsolation: async () => ({ mode: "auto", active: true }) }));
    vi.doMock("../aihub", () => ({
      resolveAgent,
      getAgentById: async (id: string) => pinned && pinned.id === id ? { ...pinned, persona: `PINNED ${pinned.name}`, constraintsText: "", productInfo: "", model: null, active: false } : null,
      listFunctions: async () => [], executeAiFunction: async () => null, isToneEnabled: async () => false,
    }));
    vi.doMock("../kb", async (orig) => ({ ...(await orig<typeof import("../kb")>()), retrieve }));
    vi.doMock("../ai/chat", () => ({
      runChat: async (o: { system?: string }) => { prompts.push(o.system ?? ""); return { text: "ok", toolCalls: [] }; },
      providerSupportsMedia: () => false,
    }));
    vi.doMock("../ai/keys", () => ({
      resolveTenantAi: async () => ({ provider: "gemini", model: "gemini-2.5-flash", apiKey: "k" }),
      AiKeyMissingError: class extends Error {},
    }));
    vi.doMock("../feature-guard", () => ({ accountCanSend: async () => true }));
    vi.doMock("../moderation", () => ({ moderateText: async () => ({ allowed: true, reason: null }) }));
    const { generateReply } = await import("../llm");
    await generateReply([{ role: "user", body: "what does it cost?" }], undefined, agentId, "t1", scope, false, undefined, "webchat", "what does it cost?");
    return { prompt: prompts.join("\n"), retrieve, resolveAgent };
  }

  it("never falls back to the default persona — an unpinned channel gets the neutral assistant", async () => {
    const { prompt, resolveAgent } = await run(null, { tag: "website", strict: true });
    expect(resolveAgent).not.toHaveBeenCalled();
    expect(prompt).not.toContain("SPIRITUAL PERSONA");
    expect(prompt).toContain(NEUTRAL_AGENT.persona.split("\n")[0]);
  });

  it("a deleted pinned persona also gets the neutral assistant, not the default", async () => {
    const { prompt } = await run("deleted-id", { tag: "website", strict: true });
    expect(prompt).not.toContain("SPIRITUAL PERSONA");
    expect(prompt).toContain(NEUTRAL_AGENT.persona.split("\n")[0]);
  });

  it("a pinned persona speaks as itself", async () => {
    const { prompt } = await run("talko", { tag: "website", strict: true }, { id: "talko", name: "Talko" });
    expect(prompt).toContain("PINNED Talko");
    expect(prompt).not.toContain("SPIRITUAL PERSONA");
  });

  it("a channel with no knowledge tag reads no documents at all", async () => {
    const { retrieve, prompt } = await run(null, { tag: null, strict: false });
    expect(prompt).toContain(NEUTRAL_AGENT.persona.split("\n")[0]);   // it did reach the model
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("a flow-set tag is held as a boundary — it never widens to every document", async () => {
    const { retrieve } = await run(null, { tag: "website", strict: false });
    expect(retrieve).toHaveBeenCalled();
    for (const call of retrieve.mock.calls as unknown[][]) expect(call[3]).toEqual({ tag: "website", strict: true });
  });
});
