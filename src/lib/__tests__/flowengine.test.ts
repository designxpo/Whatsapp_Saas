import { describe, it, expect, vi } from "vitest";

// flowengine imports store/whatsapp/instagram which pull in supabase; none are
// invoked by the pure routing helpers we test, but stub the heaviest leaf so
// importing the module never tries to construct a client.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure routing tests"); } }));

import { nextNode, matchOption, optionLabel, looksConversational, looksLikeName, validateInput, retryHint, type FlowGraph, type FlowNode } from "@/lib/flowengine";

// Node factory — `position` is required by the builder type but irrelevant here.
const n = (id: string, type: string, data: Record<string, unknown> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data });

const graph: FlowGraph = {
  nodes: [
    n("start", "start"),
    n("msg", "message", { text: "hi" }),
    n("cond", "condition"),
    n("yes", "message", { text: "yes branch" }),
    n("no", "message", { text: "no branch" }),
  ],
  edges: [
    { id: "e1", source: "start", target: "msg" },
    { id: "e2", source: "cond", sourceHandle: "yes", target: "yes" },
    { id: "e3", source: "cond", sourceHandle: "no", target: "no" },
  ],
};

describe("nextNode (graph routing)", () => {
  it("follows the default edge", () => {
    expect(nextNode(graph, "start")?.id).toBe("msg");
  });
  it("follows a named branch handle", () => {
    expect(nextNode(graph, "cond", "yes")?.id).toBe("yes");
    expect(nextNode(graph, "cond", "no")?.id).toBe("no");
  });
  it("returns undefined at a dead end", () => {
    expect(nextNode(graph, "msg")).toBeUndefined();
  });
});

const buttonsNode = n("b", "buttons", { buttons: [{ id: "opt_sales", title: "Talk to Sales" }, { id: "opt_support", title: "Support" }] });
const listNode = n("l", "list", { rows: [{ id: "row_a", title: "Option A" }, { id: "row_b", title: "Option B" }] });

describe("matchOption (reply → option id)", () => {
  it("matches a button by title (case-insensitive)", () => {
    expect(matchOption(buttonsNode, "talk to sales")).toBe("opt_sales");
  });
  it("matches a button by id", () => {
    expect(matchOption(buttonsNode, "opt_support")).toBe("opt_support");
  });
  it("matches a list row by title", () => {
    expect(matchOption(listNode, "Option B")).toBe("row_b");
  });
  it("returns null for no match or empty text", () => {
    expect(matchOption(buttonsNode, "nonsense")).toBeNull();
    expect(matchOption(buttonsNode, "")).toBeNull();
  });
  it("matches by typed number (IG text menu / quick-reply position)", () => {
    expect(matchOption(buttonsNode, "1")).toBe("opt_sales");
    expect(matchOption(buttonsNode, "2")).toBe("opt_support");
    expect(matchOption(listNode, "2")).toBe("row_b");
  });
  it("ignores out-of-range numbers", () => {
    expect(matchOption(buttonsNode, "9")).toBeNull();
    expect(matchOption(buttonsNode, "0")).toBeNull();
  });
});

describe("looksConversational (ask-node escape hatch)", () => {
  it("treats questions / greetings as conversational (bail out of the field)", () => {
    expect(looksConversational("how ar you")).toBe(true);       // the reported bug
    expect(looksConversational("how are you?")).toBe(true);
    expect(looksConversational("what courses do you offer")).toBe(true);
    expect(looksConversational("can you help me")).toBe(true);
    expect(looksConversational("tell me the price")).toBe(true);
    expect(looksConversational("hi")).toBe(true);
    expect(looksConversational("hello there")).toBe(true);
    expect(looksConversational("thanks")).toBe(true);
    expect(looksConversational("anything here?")).toBe(true);   // a trailing ?
  });
  it("does NOT flag a botched answer (so the user still gets a retry)", () => {
    expect(looksConversational("john at gmail")).toBe(false);   // typo'd email → retry
    expect(looksConversational("john.doe@gmail")).toBe(false);  // missing TLD → retry
    expect(looksConversational("9876543")).toBe(false);         // short phone → retry
    expect(looksConversational("Mumbai")).toBe(false);
    expect(looksConversational("")).toBe(false);
  });
});

describe("optionLabel (option id → human label)", () => {
  it("resolves a button label", () => {
    expect(optionLabel(buttonsNode, "opt_sales")).toBe("Talk to Sales");
  });
  it("resolves a list row label", () => {
    expect(optionLabel(listNode, "row_a")).toBe("Option A");
  });
  it("returns empty string for an unknown id", () => {
    expect(optionLabel(buttonsNode, "missing")).toBe("");
  });
});

describe("validateInput — phone must be landable, not merely plausible", () => {
  // The ask-time gate has to match the CRM-landing gate (10–15 digits): an
  // accepted-but-unlandable number thanks the visitor and silently drops the
  // lead (the 8-digit web-chat tester case, 2026-07-17).
  it("rejects short numbers so the bot re-asks instead of dropping the lead", async () => {
    expect(await validateInput("phone", "72827916")).toBe(false);          // 8 digits — the reported bug
    expect(await validateInput("phone", "+91 728-279")).toBe(false);       // 9 digits with formatting
    expect(await validateInput("phone", "12345678901234567")).toBe(false); // 17 digits — beyond E.164
  });
  it("accepts real 10-15 digit numbers, with or without formatting", async () => {
    expect(await validateInput("phone", "8368872108")).toBe(true);
    expect(await validateInput("phone", "+91 83688 72108")).toBe(true);
    expect(await validateInput("phone", "918368872108")).toBe(true);
  });
  it("email stays strict alongside", async () => {
    expect(await validateInput("email", "tanvvitest82828@mail.com")).toBe(true);
    expect(await validateInput("email", "not-an-email")).toBe(false);
  });
  it("re-ask hint says what a valid answer looks like", () => {
    expect(retryHint("phone")).toMatch(/country code/);
    expect(retryHint("email")).toMatch(/email address/);
    expect(retryHint("number")).toMatch(/valid answer/);
  });
});

describe("looksLikeName — inquiries are not names", () => {
  it("rejects inquiry sentences, conversational openers, digit runs", () => {
    expect(looksLikeName("Want to know about courses")).toBe(false);  // stored as a lead name once
    expect(looksLikeName("tell me about courses")).toBe(false);
    expect(looksLikeName("9876543210")).toBe(false);
    expect(looksLikeName("need fee details")).toBe(false);
  });
  it("accepts real names", () => {
    expect(looksLikeName("Priyesh")).toBe(true);
    expect(looksLikeName("Priyesh Mishra")).toBe(true);
    expect(looksLikeName("A P J Abdul Kalam")).toBe(true);
  });
});
