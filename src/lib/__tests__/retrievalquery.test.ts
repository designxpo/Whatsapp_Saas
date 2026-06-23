import { describe, it, expect, vi } from "vitest";

// llm.ts pulls in store/kb/ai → supabase. retrievalQuery is pure; stub the
// heaviest leaf so the import stays offline.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called"); } }));

import { retrievalQuery } from "@/lib/llm";

const u = (body: string) => ({ role: "user" as const, body });
const a = (body: string) => ({ role: "assistant" as const, body });

describe("retrievalQuery — fuse only genuine follow-ups", () => {
  it("returns a self-contained short question UNCHANGED (no topic drift)", () => {
    const h = [u("Tell me about the data science course"), a("Sure, here are the details…"), u("Python course fees?")];
    expect(retrievalQuery(h)).toBe("Python course fees?");
  });

  it("fuses an anaphoric opener with the prior user turn", () => {
    const h = [u("Tell me about the data science course"), a("…"), u("and the duration?")];
    expect(retrievalQuery(h)).toBe("Tell me about the data science course and the duration?");
  });

  it("fuses a bare aspect word with the prior user turn", () => {
    const h = [u("I'm interested in the data science program"), a("…"), u("fees?")];
    expect(retrievalQuery(h)).toBe("I'm interested in the data science program fees?");
  });

  it("fuses 'what about X' follow-ups", () => {
    const h = [u("data science course details"), a("…"), u("what about placements")];
    expect(retrievalQuery(h)).toBe("data science course details what about placements");
  });

  it("leaves a full standalone question alone", () => {
    const h = [u("What is data science?")];
    expect(retrievalQuery(h)).toBe("What is data science?");
  });

  it("only uses ONE prior turn, not two", () => {
    const h = [u("first topic"), a("…"), u("second topic about generative ai"), a("…"), u("tell me more")];
    expect(retrievalQuery(h)).toBe("second topic about generative ai tell me more");
  });

  it("a bare aspect word with no prior turn returns itself", () => {
    expect(retrievalQuery([u("fees?")])).toBe("fees?");
  });
});
