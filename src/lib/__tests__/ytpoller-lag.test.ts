// A comment that reaches the YouTube API after a later poll already ran — index
// lag, or a held-for-review comment approved later — carries a publish time
// BEHIND the cursor. It used to be skipped forever; it must now be answered.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ cursor: "2026-10-16T12:00:00.000Z", writes: [] as Record<string, unknown>[] }));

vi.mock("../supabase", () => {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, gte: () => b,
    maybeSingle: async () => ({ data: { last_polled_at: h.cursor } }),
    upsert: async (row: Record<string, unknown>) => { h.writes.push(row); return { error: null }; },
  });
  return { db: () => ({ from: () => b }) };
});
vi.mock("../youtube", () => ({
  youtubeConfigured: () => true,
  listNewComments: vi.fn(),
  replyToComment: vi.fn(async () => ({ ok: true, id: "reply-id" })),
  setModeration: vi.fn(async () => ({ ok: true })),
  getThreads: vi.fn(async () => []),
  getChannelHandle: vi.fn(async () => "@self"),
}));
vi.mock("../channels", () => ({
  listChannels: vi.fn(),
  effectiveAgentId: () => null,
  effectiveKbScope: () => ({ tag: null, strict: false }),
}));
vi.mock("../messaging-settings", () => ({ isAiEnabled: vi.fn(async () => true) }));
vi.mock("../llm", () => ({ generateReply: vi.fn(async () => ({ reply: "Jai Mata Di 🙏", escalate: false })) }));
vi.mock("../ytcomments", () => ({
  getYtDailyReplyCap: vi.fn(async () => 100),
  ytActionsUsedToday: vi.fn(async () => 0),
  matchYtCommentRule: vi.fn(async () => null),
  claimYtComment: vi.fn(async () => true),
  claimedYtCommentIds: vi.fn(async () => new Set<string>()),
  listYtCommentRules: vi.fn(async () => []),
  getYtWatch: vi.fn(async () => ({ threads: {}, seeded: true })),
  saveYtWatch: vi.fn(async () => {}),
  recentlyAnsweredThreads: vi.fn(async () => []),
  bumpYtRuleMatch: vi.fn(async () => {}),
}));

import { drainYtComments } from "../ytpoller";
import { listNewComments, replyToComment } from "../youtube";
import { listChannels } from "../channels";
import { claimedYtCommentIds } from "../ytcomments";

const CHANNEL = {
  id: "chan-1", tenantId: "t1", kind: "youtube", active: true, ytChannelId: "UC_self",
  token: "refresh", commentAi: true, createdAt: "2026-08-12T15:45:18.379Z",
};
const late = { id: "late", videoId: "v1", text: "Jai Ma Durga Devi", authorChannelId: "UC_viewer", publishedAt: "2026-10-16T11:40:01Z" };
const lastWrite = () => h.writes[h.writes.length - 1];

beforeEach(() => {
  h.writes.length = 0;
  h.cursor = "2026-10-16T12:00:00.000Z";
  vi.mocked(listChannels).mockResolvedValue([CHANNEL] as never);
  vi.mocked(replyToComment).mockClear();
  vi.mocked(claimedYtCommentIds).mockResolvedValue(new Set());
});

describe("drainYtComments — comments that surface late", () => {
  it("re-reads a window behind the cursor and answers a late-visible comment", async () => {
    vi.mocked(listNewComments).mockResolvedValue([late] as never);
    expect(await drainYtComments()).toBe(1);
    expect(replyToComment).toHaveBeenCalledWith(expect.anything(), "late", "Jai Mata Di 🙏");
    // Asked for comments from 24h before the cursor, not from the cursor itself.
    const floor = vi.mocked(listNewComments).mock.calls[0][1] as Date;
    expect(floor.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    // The late comment must not drag the watermark backwards.
    expect(lastWrite().last_polled_at).toBe(h.cursor);
  });

  it("skips comments in the window that were already answered", async () => {
    vi.mocked(listNewComments).mockResolvedValue([late] as never);
    vi.mocked(claimedYtCommentIds).mockResolvedValue(new Set(["late"]));
    expect(await drainYtComments()).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("never moves the watermark to the wall clock when a poll finds nothing", async () => {
    vi.mocked(listNewComments).mockResolvedValue([] as never);
    await drainYtComments();
    expect(lastWrite().last_polled_at).toBe(h.cursor);
    // …while still recording that the check happened.
    expect(Date.parse(lastWrite().last_checked_at as string)).toBeGreaterThan(Date.parse(h.cursor));
  });

  it("never reads back past the moment the channel was connected", async () => {
    h.cursor = "2026-08-12T16:00:00.000Z";   // connected 15 minutes earlier
    vi.mocked(listNewComments).mockResolvedValue([] as never);
    await drainYtComments();
    const floor = vi.mocked(listNewComments).mock.calls.at(-1)![1] as Date;
    expect(floor.toISOString()).toBe("2026-08-12T15:45:18.379Z");
  });
});
