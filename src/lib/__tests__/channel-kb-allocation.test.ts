// Per-channel KB + AI-agent allocation — the resolution chain every reply
// pipeline (WhatsApp, Instagram, Messenger, web chat) now shares:
//
//   agent:    conversation pin  →  channel agent_id  →  null (tenant's active agent)
//   KB scope: conversation tag  →  channel kb_tag    →  null (tenant's whole KB)
//
// The conversation override must ALWAYS outrank the channel default — a flow
// that stamps its primary KB tag (e.g. a masterclass flow) narrows the scope
// even on a channel that has its own allocated KB, and a flow-pinned agent
// keeps the persona it chose. Null/undefined at every level falls through.
import { describe, it, expect } from "vitest";
import { effectiveAgentId, effectiveKbTag } from "../channels";

const AGENT_A = "11111111-1111-1111-1111-111111111111";
const AGENT_B = "22222222-2222-2222-2222-222222222222";

describe("effectiveAgentId", () => {
  it("conversation pin outranks the channel default", () => {
    expect(effectiveAgentId({ agentId: AGENT_A }, { agentId: AGENT_B })).toBe(AGENT_A);
  });

  it("falls back to the channel's agent when the conversation has no pin", () => {
    expect(effectiveAgentId({ agentId: null }, { agentId: AGENT_B })).toBe(AGENT_B);
    expect(effectiveAgentId({}, { agentId: AGENT_B })).toBe(AGENT_B);
  });

  it("resolves to null (the tenant's active agent) when neither is set", () => {
    expect(effectiveAgentId({ agentId: null }, { agentId: null })).toBeNull();
    expect(effectiveAgentId({}, {})).toBeNull();
  });

  it("tolerates a missing channel (env single-number mode) and missing conversation", () => {
    expect(effectiveAgentId({ agentId: AGENT_A }, null)).toBe(AGENT_A);
    expect(effectiveAgentId({ agentId: null }, undefined)).toBeNull();
    expect(effectiveAgentId(null, { agentId: AGENT_B })).toBe(AGENT_B);
    expect(effectiveAgentId(undefined, undefined)).toBeNull();
  });
});

describe("effectiveKbTag", () => {
  it("a flow-stamped conversation tag outranks the channel's allocated KB", () => {
    expect(effectiveKbTag({ primaryKbTag: "masterclass" }, { kbTag: "data-science" })).toBe("masterclass");
  });

  it("falls back to the channel's KB when no flow has scoped the conversation", () => {
    expect(effectiveKbTag({ primaryKbTag: null }, { kbTag: "data-science" })).toBe("data-science");
    expect(effectiveKbTag({}, { kbTag: "data-science" })).toBe("data-science");
  });

  it("resolves to null (the tenant's whole KB) when neither is set", () => {
    expect(effectiveKbTag({ primaryKbTag: null }, { kbTag: null })).toBeNull();
    expect(effectiveKbTag({}, {})).toBeNull();
  });

  it("tolerates a missing channel and missing conversation", () => {
    expect(effectiveKbTag({ primaryKbTag: "masterclass" }, null)).toBe("masterclass");
    expect(effectiveKbTag({ primaryKbTag: null }, undefined)).toBeNull();
    expect(effectiveKbTag(null, { kbTag: "data-science" })).toBe("data-science");
    expect(effectiveKbTag(undefined, undefined)).toBeNull();
  });

  it("the two chains stay independent — a channel KB never drags in the channel agent", () => {
    const conv = { agentId: AGENT_A, primaryKbTag: null };
    const channel = { agentId: AGENT_B, kbTag: "data-science" };
    expect(effectiveAgentId(conv, channel)).toBe(AGENT_A);      // pin kept
    expect(effectiveKbTag(conv, channel)).toBe("data-science"); // channel KB used
  });
});
