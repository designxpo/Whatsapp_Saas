import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The content-safety layer. These tests lock in the two things most likely to
// regress: (1) the keyword fallback must not block legitimate business copy —
// an earlier revision blocked 9 of 20 real strings, including the Spanish name
// "Kike" and automotive "tranny"; and (2) the hosted check must WIN over the
// keyword list when it's reachable, so context-dependent wording is judged by
// the model rather than hard-blocked by a word match.

vi.mock("../supabase", () => ({ db: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }));

const ORIGINAL_KEY = process.env.MODERATION_API_KEY;

async function load() {
  vi.resetModules();
  return import("../moderation");
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.MODERATION_API_KEY;
  else process.env.MODERATION_API_KEY = ORIGINAL_KEY;
});

// Legitimate copy a real business would plausibly send. None may be blocked.
const LEGITIMATE = [
  "Thanks for your order! It ships tomorrow.",
  "Our spice blend is a customer favourite.",
  "Please specify your delivery address.",
  "This kit includes a chink-free ceramic finish.",
  "Our tranny repair service covers all models.",
  "Kike Rodriguez will be your account manager.",
  "Check the CP link for your campaign report.",
  "I will kill the campaign if CPC rises.",
  "We killed it this quarter!",
  "Flame-retardant fabric, fire safe.",
  "Our KYC process takes 2 days.",
  "Childproof packaging available.",
  "Assist with classification of grapes.",
];

// Content that must never reach a customer.
const HARMFUL = [
  "you are a nigger",
  "faggots",
  "i will kill you",
  "im going to kill you",
  "kill yourself",
  "kys loser",
  "child porn",
  "childp0rn",
  "preteen nude",
];

describe("moderation — keyword fallback (no API key configured)", () => {
  it("allows every legitimate business string", async () => {
    delete process.env.MODERATION_API_KEY;
    const { moderateText } = await load();
    for (const text of LEGITIMATE) {
      const v = await moderateText(text, { surface: "ai_reply" });
      expect(v.allowed, `should allow: ${text}`).toBe(true);
    }
  });

  it("blocks unambiguous slurs, threats and child-safety terms", async () => {
    delete process.env.MODERATION_API_KEY;
    const { moderateText } = await load();
    for (const text of HARMFUL) {
      const v = await moderateText(text, { surface: "ai_reply" });
      expect(v.allowed, `should block: ${text}`).toBe(false);
    }
  });

  it("reports itself as unconfigured so callers can tell the hosted check is inert", async () => {
    delete process.env.MODERATION_API_KEY;
    const { moderationConfigured } = await load();
    expect(moderationConfigured()).toBe(false);
  });
});

describe("moderation — hosted check takes precedence", () => {
  it("allows a keyword-listed term when the model says it's fine in context", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 },
    )));
    // Would trip the keyword fallback, but the model has the menu context.
    const v = await moderateText("Order the faggots and peas special.", { surface: "ai_reply" });
    expect(v.allowed).toBe(true);
  });

  it("blocks and names the categories the model flagged", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ results: [{ flagged: true, categories: { harassment: true, hate: true, violence: false } }] }), { status: 200 },
    )));
    const v = await moderateText("something the model dislikes", { surface: "comment_reply" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("harassment");
    expect(v.reason).toContain("hate");
    expect(v.reason).not.toContain("violence");
  });

  it("falls back to the keyword list when the API is unreachable, rather than failing open entirely", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect((await moderateText("i will kill you", { surface: "ai_reply" })).allowed).toBe(false);
    // …while a benign message still gets through during the outage.
    expect((await moderateText("Your order ships today.", { surface: "ai_reply" })).allowed).toBe(true);
  });

  it("does not block on a non-200 from the API (outage must not take replies offline)", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    expect((await moderateText("Your order ships today.", { surface: "ai_reply" })).allowed).toBe(true);
  });

  it("sends the documented request shape for the omni moderation endpoint", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    const spy = vi.fn(async () => new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await moderateText("hello", { surface: "ai_reply" });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/moderations");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("omni-moderation-latest");
    expect(body.input).toEqual([{ type: "text", text: "hello" }]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });
});

describe("moderation — empty input and assert helpers", () => {
  it("treats empty/whitespace text as allowed without calling the API", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect((await moderateText("   ", { surface: "ai_reply" })).allowed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("assertTextAllowed throws admin-readable copy on a block", async () => {
    delete process.env.MODERATION_API_KEY;
    const { assertTextAllowed } = await load();
    await expect(assertTextAllowed("kill yourself", { surface: "quick_reply" })).rejects.toThrow(/safety filter/i);
    await expect(assertTextAllowed("Your order ships today.", { surface: "quick_reply" })).resolves.toBeUndefined();
  });

  it("assertTextsAllowed screens many fields in one call and ignores empties", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { assertTextsAllowed } = await load();
    const spy = vi.fn(async () => new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await assertTextsAllowed(["one", null, "  ", undefined, "two"], { surface: "comment_rule" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).input[0].text).toBe("one\ntwo");
  });
});

describe("moderation — image screening", () => {
  const png = (bytes: number) => new File([new Uint8Array(bytes)], "x.png", { type: "image/png" });

  it("REJECTS an image too large to scan — the size is attacker-controlled, so allowing it would let padding defeat the check", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateImageFile } = await load();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const v = await moderateImageFile(png(8 * 1024 * 1024 + 1), { surface: "upload" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("too_large_to_scan");
    expect(spy).not.toHaveBeenCalled();
  });

  it("scans an image under the cap and honours the verdict", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateImageFile } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ results: [{ flagged: true, categories: { sexual: true } }] }), { status: 200 },
    )));
    const v = await moderateImageFile(png(1024), { surface: "upload" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("sexual");
  });

  it("leaves the file re-readable so the caller can still upload it after screening", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateImageFile } = await load();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 })));
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "x.png", { type: "image/png" });
    expect((await moderateImageFile(file, { surface: "upload" })).allowed).toBe(true);
    expect(Buffer.from(await file.arrayBuffer()).length).toBe(5);
  });

  it("passes through non-image uploads (PDF/video aren't scored by the model)", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateImageFile } = await load();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const pdf = new File([new Uint8Array(999)], "d.pdf", { type: "application/pdf" });
    expect((await moderateImageFile(pdf, { surface: "upload" })).allowed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("moderation — verdict cache", () => {
  it("screens repeated identical text once, so send-path double-checks and broadcast fan-out stay cheap", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    const spy = vi.fn(async () => new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    for (let i = 0; i < 5; i++) await moderateText("Your order ships today.", { surface: "ai_reply" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not cache an outage result — a retry must re-ask once the API is back", async () => {
    process.env.MODERATION_API_KEY = "test-key";
    const { moderateText } = await load();
    const failing = vi.fn(async () => { throw new Error("down"); });
    vi.stubGlobal("fetch", failing);
    await moderateText("unique-outage-probe", { surface: "ai_reply" });
    expect(failing).toHaveBeenCalledTimes(1);
    // Same text again → asks again rather than reusing the degraded verdict.
    await moderateText("unique-outage-probe", { surface: "ai_reply" });
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("moderation — collectStrings", () => {
  it("pulls human copy out of an untyped flow graph node payload", async () => {
    const { collectStrings } = await load();
    const nodes = [
      { label: "Welcome", message: "Hi there!", buttons: [{ label: "Yes" }, { label: "No" }] },
      { message: "Second step" },
    ];
    const found = collectStrings(nodes);
    expect(found).toContain("Hi there!");
    expect(found).toContain("Yes");
    expect(found).toContain("Second step");
  });

  it("skips media/identifier fields so URLs and ids aren't scored as prose", async () => {
    const { collectStrings } = await load();
    const found = collectStrings({
      message: "Real copy",
      imageUrl: "https://example.com/a.png",
      mediaUrl: "https://example.com/b.mp4",
      id: "node-123",
      channelIds: ["abc"],
      color: "#ff0000",
    });
    expect(found).toEqual(["Real copy"]);
  });

  it("is depth-bounded so a pathological nested payload can't hang a save", async () => {
    const { collectStrings } = await load();
    let deep: unknown = "buried";
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(collectStrings(deep)).toEqual([]);
  });
});
