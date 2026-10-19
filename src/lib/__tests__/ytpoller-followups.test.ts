// The poller end to end for follow-ups: a watched thread with a new reply that
// tags the channel gets one AI answer, addressed to its author, in the thread.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ watch: null as unknown, saved: [] as unknown[], budgetUsed: 0 }));

vi.mock("../supabase", () => {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, gte: () => b,
    maybeSingle: async () => ({ data: { last_polled_at: "2026-10-19T05:00:00.000Z" } }),
    upsert: async () => ({ error: null }),
  });
  return { db: () => ({ from: () => b }) };
});
vi.mock("../youtube", () => ({
  youtubeConfigured: () => true,
  listNewComments: vi.fn(async () => []),
  replyToComment: vi.fn(async () => ({ ok: true, id: "new-reply" })),
  setModeration: vi.fn(async () => ({ ok: true })),
  getThreads: vi.fn(),
  getChannelHandle: vi.fn(async () => "@spiritualtalksofficiall"),
}));
vi.mock("../channels", () => ({
  listChannels: vi.fn(),
  effectiveAgentId: () => "agent-1",
  effectiveKbScope: () => ({ tag: null, strict: false }),
}));
vi.mock("../messaging-settings", () => ({ isAiEnabled: vi.fn(async () => true) }));
vi.mock("../llm", () => ({ generateReply: vi.fn(async () => ({ reply: "So true — Ma Durga is worshipped across India 🙏", escalate: false })) , isCannedNonAnswer: (s: string | null) => s === "Thanks for your message! A team member will get back to you shortly." }));
vi.mock("../ytcomments", () => ({
  getYtDailyReplyCap: vi.fn(async () => 100),
  ytActionsUsedToday: vi.fn(async () => h.budgetUsed),
  matchYtCommentRule: vi.fn(async () => null),
  claimYtComment: vi.fn(async () => true),
  claimedYtCommentIds: vi.fn(async () => new Set<string>()),
  listYtCommentRules: vi.fn(async () => []),
  bumpYtRuleMatch: vi.fn(async () => {}),
  getYtWatch: vi.fn(async () => structuredClone(h.watch)),
  saveYtWatch: vi.fn(async (_c: string, _t: string, w: unknown) => { h.saved.push(structuredClone(w)); }),
  releaseYtComment: vi.fn(async () => {}),
  recentlyAnsweredThreads: vi.fn(async () => [{ threadId: "T1", at: "2026-10-13T16:25:15Z" }]),
}));

import { drainYtComments } from "../ytpoller";
import { getThreads, replyToComment } from "../youtube";
import { listChannels } from "../channels";
import { generateReply } from "../llm";
import { claimYtComment, releaseYtComment } from "../ytcomments";

const SELF = "UC_self";
const CHANNEL = { id: "chan-1", tenantId: "t1", kind: "youtube", active: true, ytChannelId: SELF, token: "rt", commentAi: true, createdAt: "2026-08-12T00:00:00Z" };
const rep = (id: string, by: string, at: string, text: string, name: string) => ({ id, authorChannelId: by, authorName: name, publishedAt: at, text });
const THREAD = {
  id: "T1", videoId: "v1", channelId: SELF, totalReplies: 2,
  top: rep("T1", "pearl", "2026-10-13T16:24:25Z", "But she was not originally from Bengal 😅", "@pearlsingh1698"),
  replies: [
    rep("T1.a", SELF, "2026-10-13T16:25:24Z", "That is very true!", "@Spiritualtalksofficiall"),
    rep("T1.b", "pearl", "2026-10-18T16:55:42Z", "​@Spiritualtalksofficiall It’s so beautiful how devotion travels", "@pearlsingh1698"),
  ],
};
const lastSaved = () => h.saved[h.saved.length - 1] as { threads: Record<string, { seen: string }>; seeded?: boolean };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-19T06:00:00Z"));
  h.saved = []; h.budgetUsed = 0;
  h.watch = { threads: {} };                                  // never seeded
  vi.mocked(listChannels).mockResolvedValue([CHANNEL] as never);
  vi.mocked(getThreads).mockResolvedValue([THREAD] as never);
  vi.mocked(replyToComment).mockClear();
  vi.mocked(generateReply).mockClear();
  vi.mocked(claimYtComment).mockClear();
  vi.mocked(releaseYtComment).mockClear();
  vi.mocked(generateReply).mockResolvedValue({ reply: "So true — Ma Durga is worshipped across India 🙏", escalate: false } as never);
});

describe("drainYtComments — thread follow-ups", () => {
  it("answers a tagged reply in a thread answered before this shipped (seeded from the claim log)", async () => {
    expect(await drainYtComments()).toBe(1);
    expect(claimYtComment).toHaveBeenCalledWith("T1.b", null, "t1");
    // The AI sees the whole thread, ours as assistant.
    const history = vi.mocked(generateReply).mock.calls[0][0];
    expect(history.map(x => x.role)).toEqual(["user", "assistant", "user"]);
    // Posted under the thread, addressed to the person who asked.
    expect(replyToComment).toHaveBeenCalledWith(expect.anything(), "T1", "@pearlsingh1698 So true — Ma Durga is worshipped across India 🙏");
    expect(lastSaved().seeded).toBe(true);
    expect(lastSaved().threads.T1.seen).toBe("2026-10-18T16:55:42Z");
  });

  it("does not answer the same reply twice on the next tick", async () => {
    h.watch = { seeded: true, threads: { T1: { seen: "2026-10-18T16:55:42Z", active: "2026-10-18T16:55:42Z" } } };
    expect(await drainYtComments()).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("never speaks in a thread on another channel's video", async () => {
    vi.mocked(getThreads).mockResolvedValue([{ ...THREAD, channelId: "UC_other" }] as never);
    expect(await drainYtComments()).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(lastSaved().threads.T1).toBeUndefined();
  });

  it("holds the reply for later when the daily cap is used up — without skipping it", async () => {
    h.budgetUsed = 100;
    expect(await drainYtComments()).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(lastSaved().threads.T1.seen).toBe("2026-10-13T16:25:15Z");   // unchanged → retried after reset
  });

  // 2026-10-19: the workspace's Gemini key ran out of quota, generateReply fell
  // back to its private-chat placeholder, and that went out as a public comment.
  it("never posts the AI's placeholder when the AI fails — releases and retries later", async () => {
    vi.mocked(generateReply).mockResolvedValue({ reply: "Thanks for your message! A team member will get back to you shortly.", escalate: false, reason: "generation error (fallback)" } as never);
    expect(await drainYtComments()).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(releaseYtComment).toHaveBeenCalledWith("T1.b", "t1");
    expect(lastSaved().threads.T1.seen).toBe("2026-10-13T16:25:15Z");   // still unread → answered once the AI is back
  });
});
