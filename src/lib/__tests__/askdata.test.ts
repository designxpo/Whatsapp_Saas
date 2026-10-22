import { describe, it, expect, vi, beforeEach } from "vitest";

// "Ask your data": a question in, an answer built only from the read-only
// tools out, with every count it used listed underneath — on the workspace's
// own AI provider.

const h = vi.hoisted(() => ({
  turns: [] as { toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]; text?: string }[],
  requests: [] as unknown[],
  ran: [] as { name: string; tenant: string }[],
  keyed: [] as string[],
}));

vi.mock("../ai/chat", () => ({
  runChat: async (req: unknown) => {
    h.requests.push(JSON.parse(JSON.stringify(req)));
    const t = h.turns.shift() ?? { text: "" };
    return { toolCalls: t.toolCalls ?? [], text: t.text ?? "" };
  },
}));
vi.mock("../ai/keys", () => ({ resolveTenantAi: async (t: string) => { h.keyed.push(t); return { provider: "openai", apiKey: "k", model: "m" }; } }));
vi.mock("../askdata-tools", () => ({
  ASK_TOOLS: [{ name: "count_leads", description: "", params: [], required: [] }],
  runTool: async (name: string, _a: unknown, tenant: string) => {
    h.ran.push({ name, tenant });
    return name === "count_leads"
      ? { ok: true, result: { count: 40 }, description: "Leads created on 2026-10-21: 40" }
      : { ok: false, error: `There is no tool called ${name}.` };
  },
}));

const { askData } = await import("../askdata");

beforeEach(() => { h.turns = []; h.requests = []; h.ran = []; h.keyed = []; });

describe("askData", () => {
  it("answers from a tool result in the caller's workspace, and lists what it counted", async () => {
    h.turns = [
      { toolCalls: [{ id: "1", name: "count_leads", args: { from: "2026-10-21", to: "2026-10-21" } }] },
      { text: "40 new leads came in yesterday." },
    ];
    const r = await askData("How many leads yesterday?", "t1", Date.parse("2026-10-22T06:00:00Z"));
    expect(r.answer).toBe("40 new leads came in yesterday.");
    expect(r.steps).toEqual([{ tool: "count_leads", description: "Leads created on 2026-10-21: 40" }]);
    expect(h.keyed).toEqual(["t1"]);
    expect(h.ran).toEqual([{ name: "count_leads", tenant: "t1" }]);
  });

  it("tells the model today's business date, so 'yesterday' means the right day", async () => {
    h.turns = [{ text: "ok" }];
    await askData("How many leads yesterday?", "t1", Date.parse("2026-10-21T20:00:00Z"));
    expect(JSON.stringify(h.requests[0])).toContain("2026-10-22");
  });

  it("hands a tool's error back to the model instead of failing", async () => {
    h.turns = [
      { toolCalls: [{ id: "1", name: "made_up", args: {} }] },
      { text: "I can't count that, but I can count leads." },
    ];
    const r = await askData("Revenue?", "t1");
    expect(r.steps[0].description).toMatch(/no tool called made_up/);
    expect(JSON.stringify(h.requests[1])).toContain("no tool called made_up");
  });

  it("stops after a bounded number of tool rounds", async () => {
    h.turns = Array.from({ length: 20 }, (_, i) => ({ toolCalls: [{ id: String(i), name: "count_leads", args: {} }] }));
    const r = await askData("Loop forever", "t1");
    expect(h.ran.length).toBeLessThanOrEqual(5);
    expect(r.answer).toMatch(/narrow/i);
  });

  it("refuses an empty or oversized question without calling the model", async () => {
    await expect(askData("   ", "t1")).rejects.toThrow();
    await expect(askData("x".repeat(600), "t1")).rejects.toThrow();
    expect(h.requests).toHaveLength(0);
  });
});
