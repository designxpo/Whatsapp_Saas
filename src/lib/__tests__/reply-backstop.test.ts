// The AI reply safety net for Instagram, Messenger and the website chat
// (src/lib/replybackstop.ts). A failed inline reply used to leave the lead in
// silence on these channels — and the sweep used to try to answer them through
// WhatsApp. What must hold:
//  - it never races the inline attempt, and never answers twice;
//  - it never answers what the inline path deliberately leaves alone;
//  - it delivers the channel's own way, and a failure is visible, not looped.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  conv: null as Record<string, unknown> | null,
  history: [] as { role: string; body: string }[],
  claimed: true,
  aiOn: true,
  optedOut: false,
  inSequence: false,
  inFlow: false,
  reply: { reply: "The MBA fee is ₹2.4L." } as { reply?: string; escalate?: boolean },
  throwFromAi: false,
  sendOk: true,
  log: [] as string[],
  tenants: new Set<string>(),
}));

vi.mock("../store", () => ({
  getConversation: async () => h.conv,
  getConvHistory: async (_id: string, _n: number, tid: string) => { h.tenants.add(tid); return h.history; },
  claimReply: async () => { h.log.push("claim"); return h.claimed; },
  reflagReply: async () => { h.log.push("reflag"); },
  appendConvMessage: async (p: { body: string; tenantId: string }) => { h.tenants.add(p.tenantId); h.log.push(`append:${p.body}`); return { id: "m1", createdAt: "" }; },
  touchOutbound: async () => { h.log.push("touchOutbound"); },
  escalateConversation: async () => { h.log.push("escalate"); },
  logSendFailure: async (_c: string, _ch: string, why: string) => { h.log.push(`failure:${why}`); },
  optoutSet: async (tid: string) => { h.tenants.add(tid); return new Set(h.optedOut ? [String(h.conv?.phone).slice(-10)] : []); },
}));
vi.mock("../channels", () => ({
  getChannel: async (_id: string, tid: string) => { h.tenants.add(tid); return { id: "ch1", igUserId: "ig-acct", pageId: "page-1", token: "tok" }; },
  effectiveAgentId: () => null,
  effectiveKbScope: () => null,
}));
vi.mock("../llm", () => ({
  generateReply: async (...args: unknown[]) => {
    h.tenants.add(args[3] as string);
    h.log.push(`ai:askPhone=${args[5]}:${args[7]}:commerce=${JSON.stringify(args[6] ?? null)}:canAct=${(args[9] as { canAct?: boolean })?.canAct}`);
    if (h.throwFromAi) throw new Error("model timed out");
    return h.reply;
  },
}));
vi.mock("../messaging-settings", () => ({ isAiEnabled: async (tid: string) => { h.tenants.add(tid); return h.aiOn; } }));
vi.mock("../sequences", () => ({ hasActiveDripEnrollment: async (_p: string, tid: string) => { h.tenants.add(tid); return h.inSequence; } }));
vi.mock("../flowengine", () => ({ inFlow: async (_c: string, tid: string) => { h.tenants.add(tid); return h.inFlow; } }));
vi.mock("../instagram", () => ({
  sendIgMessage: async (creds: { igUserId: string }, to: string, text: string) => { h.log.push(`ig:${creds.igUserId}->${to}:${text}`); return h.sendOk ? { ok: true } : { ok: false, error: "outside the messaging window" }; },
}));
vi.mock("../messenger", () => ({
  sendFbMessage: async (creds: { pageId: string }, to: string, text: string) => { h.log.push(`fb:${creds.pageId}->${to}:${text}`); return h.sendOk ? { ok: true } : { ok: false, error: "blocked" }; },
}));

const { backstopDecision, answerUnanswered, SETTLE_MS } = await import("../replybackstop");
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const base = { platform: "instagram", botEnabled: true, status: "active", isComment: false, lastInboundAt: ago(SETTLE_MS + 60_000) };
const asked = [{ role: "assistant", body: "Hi!" }, { role: "user", body: "What are the fees?" }];

beforeEach(() => {
  h.conv = { id: "c1", tenantId: "t-acme", phone: "17841400000000001", channelId: "ch1", leadPhone: null, ...base };
  h.history = asked; h.claimed = true; h.aiOn = true; h.optedOut = false; h.inSequence = false; h.inFlow = false;
  h.reply = { reply: "The MBA fee is ₹2.4L." }; h.throwFromAi = false; h.sendOk = true; h.log = []; h.tenants = new Set();
});

describe("which chats the safety net may answer", () => {
  it("answers an unanswered Instagram, Messenger or website chat", () => {
    for (const platform of ["instagram", "messenger", "webchat"]) expect(backstopDecision({ ...base, platform } as never, asked, NOW), platform).toEqual({ ok: true });
  });

  it("leaves WhatsApp to its own sweep — whose reply pipeline in turn refuses every other channel", () => {
    expect(backstopDecision({ ...base, platform: "whatsapp" } as never, asked, NOW)).toMatchObject({ ok: false });
    // It used to answer an unanswered Instagram chat by WhatsApp, every minute.
    const assistant = readFileSync(join(process.cwd(), "src/lib/assistant.ts"), "utf8");
    expect(assistant).toMatch(/if \(conv\.platform !== "whatsapp"\) return \{ outcome: "skipped"/);
  });

  it("never races the inline reply: waits past the webhooks' own time limit", () => {
    expect(SETTLE_MS).toBeGreaterThan(180_000);   // maxDuration on all three routes
    expect(backstopDecision({ ...base, lastInboundAt: ago(150_000) } as never, asked, NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/may still be running/) });
  });

  it("one attempt per message: anything from us after their message — a reply or a failure note — means leave it", () => {
    expect(backstopDecision(base as never, [...asked, { role: "assistant", body: "⚠️ Reply not delivered: blocked" }], NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/already/) });
  });

  it("leaves alone what the inline path leaves alone", () => {
    expect(backstopDecision({ ...base, botEnabled: false } as never, asked, NOW)).toMatchObject({ ok: false });
    expect(backstopDecision({ ...base, status: "paused" } as never, asked, NOW)).toMatchObject({ ok: false });
    expect(backstopDecision({ ...base, isComment: true } as never, asked, NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/comment/) });
    expect(backstopDecision({ ...base, platform: "messenger" } as never, [{ role: "user", body: "" }], NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/media/) });
    expect(backstopDecision({ ...base, platform: "instagram" } as never, [{ role: "user", body: "" }], NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/media/) });
    expect(backstopDecision({ ...base, lastInboundAt: ago(25 * 3600_000) } as never, asked, NOW)).toMatchObject({ ok: false, why: expect.stringMatching(/24-hour/) });
  });
});

describe("answering", () => {
  it("Instagram: replies by DM from the chat's own account, as the inline DM path does, and records it", async () => {
    expect(await answerUnanswered("c1", NOW)).toEqual({ outcome: "sent" });
    expect(h.log).toEqual([
      "claim", 'ai:askPhone=true:instagram:commerce={"platform":"instagram","conversationId":"c1"}:canAct=true',
      "ig:ig-acct->17841400000000001:The MBA fee is ₹2.4L.",
      "append:The MBA fee is ₹2.4L.", "touchOutbound",
    ]);
  });

  it("Messenger: replies from the Page", async () => {
    h.conv = { ...h.conv, platform: "messenger", phone: "2345678901234567" };
    await answerUnanswered("c1", NOW);
    expect(h.log).toContain("fb:page-1->2345678901234567:The MBA fee is ₹2.4L.");
  });

  it("website chat: nothing to send — the reply is added to the chat and the widget's poll shows it", async () => {
    h.conv = { ...h.conv, platform: "webchat", phone: "web:visitor-1" };
    expect(await answerUnanswered("c1", NOW)).toEqual({ outcome: "sent" });
    expect(h.log.filter(l => /^(ig|fb):/.test(l))).toEqual([]);
    expect(h.log).toContain("append:The MBA fee is ₹2.4L.");
  });

  it("a failed send is a visible note, and the chat stays flagged for a person", async () => {
    h.sendOk = false;
    expect(await answerUnanswered("c1", NOW)).toMatchObject({ outcome: "failed" });
    expect(h.log).toContain("failure:outside the messaging window");
    expect(h.log).toContain("reflag");
    expect(h.log).not.toContain("touchOutbound");
  });

  it("a model failure is a visible note too — so it is not retried every minute", async () => {
    h.throwFromAi = true;
    expect(await answerUnanswered("c1", NOW)).toMatchObject({ outcome: "failed" });
    expect(h.log).toContain("failure:the AI could not answer (model timed out)");
    expect(h.log).toContain("reflag");
  });

  it("hands the chat to a person when the model escalates, with the channel's closing line", async () => {
    h.reply = { escalate: true };
    expect(await answerUnanswered("c1", NOW)).toMatchObject({ outcome: "escalated" });
    expect(h.log).toContain("ig:ig-acct->17841400000000001:Thanks for reaching out! 🙌 Our team will connect with you shortly.");
    expect(h.log).toContain("escalate");
  });

  it("never claims a chat it should not answer: AI off, opted out, in a sequence, mid-flow", async () => {
    for (const set of [() => { h.aiOn = false; }, () => { h.optedOut = true; }, () => { h.inSequence = true; }, () => { h.inFlow = true; }]) {
      h.log = []; h.aiOn = true; h.optedOut = false; h.inSequence = false; h.inFlow = false;
      set();
      expect((await answerUnanswered("c1", NOW)).outcome).toBe("skipped");
      expect(h.log).not.toContain("claim");
    }
  });

  it("every read and write names the chat's own business", async () => {
    await answerUnanswered("c1", NOW);
    expect([...h.tenants]).toEqual(["t-acme"]);
  });

  it("answers once: a lost claim means another runner has it", async () => {
    h.claimed = false;
    expect(await answerUnanswered("c1", NOW)).toMatchObject({ outcome: "skipped", detail: "already claimed" });
    expect(h.log.some(l => l.startsWith("ai:"))).toBe(false);
  });
});
