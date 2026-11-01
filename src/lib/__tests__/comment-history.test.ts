// Reply history: importing earlier replies and paging through them. What must
// hold: only the account's OWN replies are imported, each with the comment it
// answered and who wrote it (rule / AI / AI follow-up / a person); nothing
// older than the window; the import moves a bounded number of API pages per
// tick and remembers where it stopped; the list pages by (time, id) so nothing
// is skipped or repeated, and only the first page pays for a count.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { YtThread, YtReply } from "../youtube";

// ── Fakes for the import step and the list ──────────────────────────────────
const saved: Record<string, unknown> = {};
const imported: unknown[][] = [];
let threadPages: { threads: YtThread[]; next: string | null; error?: string }[] = [];
let stored: { key: string; value: unknown }[] = [];
let pageCalls = 0;
type Q = { filters: [string, ...unknown[]][]; head?: boolean };
const queries: Q[] = [];
let listRows: Record<string, unknown>[] = [];

let channels: Record<string, unknown>[] = [];
vi.mock("../channels", async (orig) => ({ ...(await orig<typeof import("../channels")>()), listChannels: vi.fn(async () => channels) }));
vi.mock("../store", () => ({ setTenantSetting: vi.fn(async (_t: string, k: string, v: unknown) => { saved[k] = JSON.parse(JSON.stringify(v)); }) }));
vi.mock("../youtube", () => ({ listThreadsPage: vi.fn(async () => { const p = threadPages[pageCalls++] ?? { threads: [], next: null }; return { ...p, calls: 1 }; }) }));
vi.mock("../instagram", () => ({ listIgMediaPage: vi.fn(), listIgCommentsPage: vi.fn(), getIgSelf: vi.fn() }));
vi.mock("../messenger", () => ({ listFbPostsPage: vi.fn(), listFbCommentsPage: vi.fn() }));
vi.mock("../supabase", () => ({
  db: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["select", "eq", "in", "like"]) b[m] = chain;
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: stored, error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock("../tenantdb", () => ({
  tdb: () => ({
    from: () => {
      const q: Q = { filters: [] };
      queries.push(q);
      const b: Record<string, unknown> = {};
      const rec = (name: string) => (...a: unknown[]) => { q.filters.push([name, ...a]); return b; };
      b.select = (_c: string, opts?: { head?: boolean }) => { q.head = !!opts?.head; return b; };
      for (const m of ["eq", "gte", "order", "limit", "or"]) b[m] = rec(m);
      b.upsert = (rows: unknown[]) => { imported.push(rows); return { select: async () => ({ data: rows, error: null }) }; };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(q.head ? { count: 42, error: null } : { data: listRows, error: null }).then(res);
      return b;
    },
  }),
}));

import { ytRepliesFromThreads, igRepliesFromComments, fbRepliesFromComments, drainReplyHistory, freshState, repliesFromRecords } from "../comment-history";
import { listCommentReplies } from "../comment-replies";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const SINCE = NOW - 365 * 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const yt = (id: string, author: string, daysAgo: number, text = id): YtReply => ({ id, text, authorChannelId: author, authorName: author === "UC_ME" ? "@me" : `@${author}`, publishedAt: at(daysAgo) });
const thread = (top: YtReply, replies: YtReply[], videoId = "v1"): YtThread => ({ id: top.id, videoId, channelId: "UC_ME", top, replies, totalReplies: replies.length });

afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); stored = []; channels = [{ id: "ch1", tenantId: "t1", kind: "youtube", active: true, ytChannelId: "UC_ME", token: "r" }]; for (const k of Object.keys(saved)) delete saved[k]; imported.length = 0; threadPages = []; pageCalls = 0; queries.length = 0; listRows = []; });

describe("finding our replies (YouTube)", () => {
  it("keeps only the channel's own replies, each with the comment it answered and who wrote it", () => {
    const t = thread(yt("top", "fan", 10, "Is this free?"), [yt("r1", "UC_ME", 9, "Yes!"), yt("fu", "fan", 8, "Thanks, and on weekends?"), yt("r2", "UC_ME", 7, "Weekends too.")]);
    const claims = new Map<string, string | null>([["top", null], ["fu", null]]);
    const rows = ytRepliesFromThreads([t], "UC_ME", SINCE, claims);
    expect(rows.map(r => [r.replyId, r.parentCommentId, r.source])).toEqual([["r1", "top", "ai"], ["r2", "fu", "ai_followup"]]);
    expect(rows[0]).toMatchObject({ commentText: "Is this free?", commentAuthor: "@fan", postId: "v1", createdAt: at(9) });
  });
  it("a rule's reply says rule; one nobody's automation claimed was a person's", () => {
    const t = thread(yt("top", "fan", 3), [yt("r1", "UC_ME", 2)]);
    expect(ytRepliesFromThreads([t], "UC_ME", SINCE, new Map([["top", "rule-1"]]))[0].source).toBe("rule");
    expect(ytRepliesFromThreads([t], "UC_ME", SINCE, new Map())[0].source).toBe("manual");
  });
  it("skips replies older than the window, and replies under the channel's own comment", () => {
    expect(ytRepliesFromThreads([thread(yt("top", "fan", 400), [yt("old", "UC_ME", 399)])], "UC_ME", SINCE, new Map())).toEqual([]);
    expect(ytRepliesFromThreads([thread(yt("mine", "UC_ME", 5), [yt("self", "UC_ME", 4)])], "UC_ME", SINCE, new Map())).toEqual([]);
  });
});

describe("finding our replies (Instagram, Facebook)", () => {
  it("Instagram matches the account by id or, failing that, by its @username", () => {
    const comments = [{ id: "c1", text: "Price?", username: "buyer", fromId: "u9", timestamp: at(3), replies: [
      { id: "x1", text: "₹999", username: "shop", fromId: "OTHER_FORM_OF_ID", timestamp: at(2), replies: [] },
    ] }];
    const rows = igRepliesFromComments(comments, ["IG_ME"], "shop", "m1", SINCE, new Map([["c1", null]]));
    expect(rows).toEqual([expect.objectContaining({ replyId: "x1", parentCommentId: "c1", commentAuthor: "@buyer", postId: "m1", source: "ai" })]);
    expect(igRepliesFromComments(comments, ["IG_ME"], null, "m1", SINCE, new Map())).toEqual([]);
    // …and by its other id when Instagram reports that one instead.
    expect(igRepliesFromComments(comments, ["IG_ME", "OTHER_FORM_OF_ID"], null, "m1", SINCE, new Map()).map(r => r.replyId)).toEqual(["x1"]);
  });
  it("Facebook keeps the Page's own replies only", () => {
    const comments = [{ id: "c1", text: "Open today?", fromName: "Asha", fromId: "u1", createdTime: at(3), replies: [
      { id: "p1", text: "Yes, till 9", fromName: "My Page", fromId: "PAGE", createdTime: at(2), replies: [] },
      { id: "u2", text: "thanks", fromName: "Asha", fromId: "u1", createdTime: at(1), replies: [] },
    ] }];
    expect(fbRepliesFromComments(comments, "PAGE", "PAGE_post", SINCE, new Map()).map(r => [r.replyId, r.source])).toEqual([["p1", "manual"]]);
  });
});

describe("the background import", () => {
  it("stops at the window's edge and remembers it is done", async () => {
    threadPages = [{ threads: [thread(yt("t1", "fan", 5), [yt("r1", "UC_ME", 4)]), thread(yt("t2", "fan", 400), [])], next: "p2" }];
    const r = await drainReplyHistory(Date.now() + 60_000);
    expect(r).toEqual({ accounts: 1, imported: 1 });
    expect(saved["reply_history:ch1"]).toMatchObject({ done: true, imported: 1 });
    expect(pageCalls).toBe(1);   // never asked for p2
  });
  it("reads a bounded number of pages per tick and picks up where it stopped", async () => {
    threadPages = Array.from({ length: 20 }, (_, i) => ({ threads: [thread(yt(`t${i}`, "fan", 1), [])], next: `p${i + 1}` }));
    await drainReplyHistory(Date.now() + 60_000);
    expect(pageCalls).toBe(8);
    expect(saved["reply_history:ch1"]).toMatchObject({ done: false, cursor: "p8" });
  });
  it("a revoked or expired token ends that account's import at once, with the reason — no endless spinner", async () => {
    threadPages = [{ threads: [], next: null, error: "Invalid OAuth access token - Cannot parse access token" }];
    await drainReplyHistory(Date.now() + 60_000);
    expect(saved["reply_history:ch1"]).toMatchObject({ done: true, error: expect.stringMatching(/Invalid OAuth/) });
  });
  it("any other failure gets three tries in a row, then stops", async () => {
    stored = [{ key: "reply_history:ch1", value: { ...freshState(NOW), failures: 2 } }];
    threadPages = [{ threads: [], next: null, error: "Backend Error" }];
    await drainReplyHistory(Date.now() + 60_000);
    expect(saved["reply_history:ch1"]).toMatchObject({ done: true, failures: 3 });
  });
  it("a success resets the count of failures", async () => {
    stored = [{ key: "reply_history:ch1", value: { ...freshState(NOW), failures: 2 } }];
    threadPages = [{ threads: [thread(yt("t", "fan", 400), [])], next: null }];
    await drainReplyHistory(Date.now() + 60_000);
    expect(saved["reply_history:ch1"]).toMatchObject({ done: true, failures: 0 });
    expect((saved["reply_history:ch1"] as { error?: string }).error).toBeFalsy();
  });
  it("never touches the demo workspace's placeholder accounts", async () => {
    channels = [{ id: "demo", tenantId: "lumi", kind: "instagram", active: true, igUserId: "17841400000000004", token: "demo-token-instagram" }];
    expect(await drainReplyHistory(Date.now() + 60_000)).toEqual({ accounts: 0, imported: 0 });
    expect(saved).toEqual({});
  });
  it("starts a year back", () => {
    expect(Date.parse(freshState(NOW).since)).toBe(SINCE);
  });
});

describe("paging the list", () => {
  const row = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, platform: "youtube", parent_comment_id: "c", reply_id: `r${i}`, reply_text: "x", source: "ai", status: "sent", created_at: at(i / 100) });
  it("first page: 25 rows within the range, a cursor for the next, and the total", async () => {
    listRows = Array.from({ length: 26 }, (_, i) => row(i));
    const r = await listCommentReplies("t1", { platform: "youtube", days: 90 });
    expect(r.replies.length).toBe(25);
    expect(r.next).toBe(`${listRows[24].created_at}|${listRows[24].id}`);
    expect(r.total).toBe(42);
    const list = queries[0];
    const gte = list.filters.find(f => f[0] === "gte")!;
    expect(Math.round((Date.now() - Date.parse(gte[2] as string)) / 86_400_000)).toBe(90);
    expect(list.filters).toEqual(expect.arrayContaining([["limit", 26]]));
  });
  it("later pages continue strictly after the cursor and skip the count", async () => {
    listRows = [row(30)];
    const cur = `${at(0.3)}|00000000-0000-4000-8000-000000000025`;
    const r = await listCommentReplies("t1", { platform: "youtube", days: 30, cursor: cur });
    expect(r.total).toBeUndefined();
    expect(r.next).toBeNull();
    expect(queries.length).toBe(1);
    expect(queries[0].filters.find(f => f[0] === "or")![1]).toBe(`created_at.lt."${at(0.3)}",and(created_at.eq."${at(0.3)}",id.lt.00000000-0000-4000-8000-000000000025)`);
  });
  it("an unknown range falls back to 30 days, and a malformed cursor to the first page", async () => {
    await listCommentReplies("t1", { platform: "youtube", days: 9999, cursor: "garbage" });
    const gte = queries[0].filters.find(f => f[0] === "gte")!;
    expect(Math.round((Date.now() - Date.parse(gte[2] as string)) / 86_400_000)).toBe(30);
    expect(queries[0].filters.some(f => f[0] === "or")).toBe(false);
  });
});

describe("from the app's own reply records", () => {
  const rec = (watch: string, root: string, depth = 0) => ({ watch_comment_id: watch, root_comment_id: root, original_text: "Jai Shree Ram", reply_text: "Jai Janki Mata 🙏", depth, created_at: "2026-07-30T05:38:56Z" });
  it("names the account's own reply by id from each comment + reply pair — no author needed from Instagram", () => {
    const rows = repliesFromRecords("instagram", [rec("C1", "C1"), rec("R1", "C1")], new Map([["C1", "rule-1"]]));
    expect(rows).toEqual([expect.objectContaining({ platform: "instagram", parentCommentId: "C1", replyId: "R1", replyText: "Jai Janki Mata 🙏", commentText: "Jai Shree Ram", source: "rule", createdAt: "2026-07-30T05:38:56Z" })]);
  });
  it("leaves follow-ups deeper in a thread alone: there the pair can't say which id is ours", () => {
    expect(repliesFromRecords("instagram", [rec("A", "C1", 1), rec("B", "C1", 1)], new Map())).toEqual([]);
  });
  it("skips a record with no reply text", () => {
    expect(repliesFromRecords("facebook", [{ ...rec("R1", "C1"), reply_text: " " }], new Map())).toEqual([]);
  });
});
