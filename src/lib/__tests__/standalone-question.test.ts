import { describe, it, expect, vi, beforeEach } from "vitest";

// Turning a follow-up into a question that stands on its own.
//
// retrievalQuery() spots follow-ups with English patterns ("and the duration?",
// "fees?"), so a Hinglish follow-up — "iski fees kitni hai?" — fell through and
// was searched as written: fees, of nothing in particular. The same raw message
// keyed the shared answer cache, so one lead's "fees?" could be served another
// product's fee answer.
//
// standaloneQuestion() asks the workspace's own model to fill in the subject
// from the earlier turns, and falls back to retrievalQuery() whenever it does
// not run — no key, a failure, a timeout — or comes back with nothing usable.

vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called"); } }));
const chat = vi.fn();
const keys = vi.fn();
vi.mock("@/lib/ai/chat", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/chat")>()), runChat: (...a: unknown[]) => chat(...a) }));
vi.mock("@/lib/ai/keys", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/keys")>()), resolveTenantAi: (...a: unknown[]) => keys(...a) }));
const retrieve = vi.fn();
vi.mock("@/lib/kb", async (orig) => ({ ...(await orig<typeof import("@/lib/kb")>()), retrieve: (...a: unknown[]) => retrieve(...a) }));

const { standaloneQuestion, retrievalQuery, retrieveForReply } = await import("@/lib/llm");
const { AiKeyMissingError } = await import("@/lib/ai/keys");

const T = "tenant-1";
const u = (body: string) => ({ role: "user" as const, body });
const a = (body: string) => ({ role: "assistant" as const, body });
const replies = (text: string) => chat.mockResolvedValue({ text, toolCalls: [] });

beforeEach(() => {
  chat.mockReset(); retrieve.mockReset(); keys.mockReset();
  keys.mockResolvedValue({ provider: "gemini", apiKey: "k", model: "m" });
});

describe("standaloneQuestion", () => {
  it("fills in the subject of a Hinglish follow-up, on the workspace's own model", async () => {
    replies("What are the fees for the Bali tour package?");
    const h = [u("Tell me about the Bali tour package"), a("Sure…"), u("iski fees kitni hai?")];
    expect(await standaloneQuestion(h, T)).toBe("What are the fees for the Bali tour package?");
    expect(keys).toHaveBeenCalledWith(T);
    expect(JSON.stringify(chat.mock.calls[0][0])).toContain("Bali tour package");
  });

  it("does not call the model for a first message or a long self-contained one", async () => {
    expect(await standaloneQuestion([u("fees?")], T)).toBe("fees?");
    const h = [u("hi"), a("Hello!"), u("What is the duration of the Bali tour package and is it all inclusive?")];
    expect(await standaloneQuestion(h, T)).toBe(h[2].body);
    expect(chat).not.toHaveBeenCalled();
  });

  it("never rewrites an acknowledgement into a question nobody asked", async () => {
    replies("What are the fees for the Bali tour package?");
    for (const msg of ["ok thanks", "thank you", "hi", "??"]) {
      await standaloneQuestion([u("Tell me about the Bali tour package"), a("Sure…"), u(msg)], T);
    }
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls back to the pattern query with no AI key, on failure, or on junk", async () => {
    const h = [u("bali tour details"), a("…"), u("and the duration?")];
    keys.mockRejectedValueOnce(new AiKeyMissingError());
    expect(await standaloneQuestion(h, T)).toBe(retrievalQuery(h));
    chat.mockRejectedValueOnce(new Error("AI_BUSY"));
    expect(await standaloneQuestion(h, T)).toBe(retrievalQuery(h));
    for (const junk of ["", "line one\nline two", "x".repeat(400)]) {
      replies(junk);
      expect(await standaloneQuestion(h, T)).toBe(retrievalQuery(h));
    }
  });
});

describe("retrieveForReply", () => {
  it("searches with the standalone question, in the workspace", async () => {
    retrieve.mockResolvedValue([{ content: "fees", similarity: 0.8 }]);
    await retrieveForReply([u("x")], T, null, "What are the fees for the Bali tour?");
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0][0]).toBe("What are the fees for the Bali tour?");
    expect(retrieve.mock.calls[0][2]).toBe(T);
  });

  it("keeps the pattern query's results when the rewrite retrieved worse", async () => {
    const h = [u("bali tour details"), a("…"), u("and the duration?")];
    retrieve.mockImplementation(async (q: string) =>
      q === retrievalQuery(h) ? [{ content: "6 nights", similarity: 0.7 }] : [{ content: "noise", similarity: 0.4 }]);
    const chunks = await retrieveForReply(h, T, null, "Something unrelated?");
    expect(chunks[0].content).toBe("6 nights");
  });

  it("does not search twice when the first search was strong", async () => {
    const h = [u("bali tour details"), a("…"), u("and the duration?")];
    retrieve.mockResolvedValue([{ content: "6 nights", similarity: 0.8 }]);
    await retrieveForReply(h, T, null, "How long is the Bali tour?");
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});
