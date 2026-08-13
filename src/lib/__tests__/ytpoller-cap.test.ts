import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared, hoisted state the module mocks read/write (vi.mock is hoisted above imports).
const h = vi.hoisted(() => ({
  SINCE_ISO: "2020-01-01T00:00:00.000Z",
  cursorWrites: [] as Record<string, unknown>[],
}));

// Supabase: only getCursor (maybeSingle) and setCursor (upsert) touch db() in this
// path — everything else that would hit the DB is mocked at the module boundary.
vi.mock("../supabase", () => {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    maybeSingle: async () => ({ data: { last_polled_at: h.SINCE_ISO } }),
    upsert: async (row: Record<string, unknown>) => { h.cursorWrites.push(row); return { error: null }; },
  });
  return { db: () => ({ from: () => builder }) };
});

vi.mock("../youtube", () => ({
  youtubeConfigured: () => true,
  listNewComments: vi.fn(),
  replyToComment: vi.fn(async () => ({ ok: true, id: "reply-id" })),
  setModeration: vi.fn(async () => {}),
}));

vi.mock("../channels", () => ({
  listChannels: vi.fn(),
  effectiveAgentId: () => null,
  effectiveKbTag: () => null,
}));

vi.mock("../messaging-settings", () => ({ isAiEnabled: vi.fn(async () => true) }));
vi.mock("../llm", () => ({ generateReply: vi.fn(async () => ({ reply: "Thanks for watching!", escalate: false })) }));

// Force a small cap so the test is fast and deterministic; keep the count + cap
// helpers mockable so we can simulate "already used N today" and per-plan caps.
vi.mock("../ytcomments", () => ({
  getYtDailyReplyCap: vi.fn(async () => 2),
  ytActionsUsedToday: vi.fn(async () => 0),
  matchYtCommentRule: vi.fn(async () => null), // no rule → AI answers (the capped path)
  claimYtComment: vi.fn(async () => true),
  bumpYtRuleMatch: vi.fn(async () => {}),
}));

import { drainYtComments } from "../ytpoller";
import { listNewComments, replyToComment } from "../youtube";
import { listChannels } from "../channels";
import { ytActionsUsedToday, getYtDailyReplyCap } from "../ytcomments";

// listNewComments returns newest-first; drainChannel reverses to oldest→newest.
const NEWEST_FIRST = [5, 4, 3, 2, 1].map((n) => ({
  id: `c${n}`,
  videoId: "v1",
  text: `comment ${n}`,
  authorChannelId: null,
  publishedAt: `2020-01-0${n}T00:00:00.000Z`, // c1 oldest … c5 newest
}));

const CHANNEL = {
  id: "chan-1",
  tenantId: "tenant-1",
  kind: "youtube",
  active: true,
  ytChannelId: "UC_self",
  token: "refresh-token",
  commentAi: true,
};

function lastCursor(): string {
  return h.cursorWrites[h.cursorWrites.length - 1]?.last_polled_at as string;
}

describe("drainYtComments daily reply cap", () => {
  beforeEach(() => {
    h.cursorWrites.length = 0;
    vi.mocked(listChannels).mockResolvedValue([CHANNEL] as never);
    vi.mocked(listNewComments).mockResolvedValue(NEWEST_FIRST as never);
    vi.mocked(replyToComment).mockClear();
    vi.mocked(ytActionsUsedToday).mockResolvedValue(0);
    vi.mocked(getYtDailyReplyCap).mockResolvedValue(2);
  });

  it("stops at the cap and leaves the cursor on the last replied comment (backlog preserved)", async () => {
    // cap 2, used 0 → budget 2. Five actionable comments → only c1 and c2 replied,
    // c3 defers the rest.
    const acted = await drainYtComments();

    expect(acted).toBe(2);
    expect(replyToComment).toHaveBeenCalledTimes(2);
    // Cursor must NOT jump to the newest (c5); it stays at c2 so c3–c5 come back.
    expect(lastCursor()).toBe("2020-01-02T00:00:00.000Z");
  });

  it("replies to nothing and keeps the cursor put when the tenant is already at the cap", async () => {
    vi.mocked(ytActionsUsedToday).mockResolvedValue(2); // budget = max(0, 2-2) = 0

    const acted = await drainYtComments();

    expect(acted).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
    // Nothing handled → cursor unchanged from the poll watermark.
    expect(lastCursor()).toBe(h.SINCE_ISO);
  });
});
