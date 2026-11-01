import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { memdb, type MemDb } from "./helpers/memdb";

// "Replies sent" names the person who commented. Replies imported from the
// app's own thread records carried no commenter (every Instagram row showed
// "Someone" in production, 2026-11-01), so:
//  - every reply recorded from now on keeps the commenter's platform id;
//  - older ones are filled in the background — from Live Chat, where the
//    comment was stored under the commenter's id moments before the reply, or
//    else by asking the platform who wrote that comment;
//  - the card shows what the workspace knows about them, from their chat.

const T = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const CH = "8d59f6d9-a04d-40e5-a6ae-efeb4f47daf5";
let m: MemDb;
let platformAsked: string[] = [];

async function load() {
  vi.resetModules();
  vi.doMock("../supabase", () => ({ db: () => m.client }));
  vi.doMock("../tenantdb", () => ({ tdb: (t: string) => ({ from: (tb: string) => (m.client.from(tb) as { eq: (c: string, v: string) => unknown }).eq("tenant_id", t) }) }));
  vi.doMock("../channels", () => ({
    listChannels: async () => [{ id: CH, tenantId: T, kind: "instagram", igUserId: "17841", token: "tok" }],
    isLiveChannel: () => true,
    getChannelById: async () => null,
  }));
  vi.doMock("../instagram", async orig => ({
    ...(await orig<typeof import("../instagram")>()),
    getIgCommentAuthor: async (_c: unknown, id: string) => { platformAsked.push(id); return id === "c-api" ? { id: "999", username: "from_api" } : { id: null, username: null, error: "Unsupported get request" }; },
  }));
  return { history: await import("../comment-history"), replies: await import("../comment-replies") };
}

beforeEach(() => {
  platformAsked = [];
  m = memdb();
  m.tables.wa_comment_replies = [
    { id: "r1", tenant_id: T, channel_id: CH, platform: "instagram", parent_comment_id: "c-chat", comment_text: "Jai Shree RadheKrishan 🙏", comment_author: null, comment_author_id: null, created_at: "2026-11-01T05:18:04.662Z" },
    { id: "r2", tenant_id: T, channel_id: CH, platform: "instagram", parent_comment_id: "c-api", comment_text: "Radhey Radhey", comment_author: null, comment_author_id: null, created_at: "2026-10-29T14:25:09.245Z" },
    { id: "r3", tenant_id: T, channel_id: CH, platform: "instagram", parent_comment_id: "c-gone", comment_text: "deleted since", comment_author: null, comment_author_id: null, created_at: "2026-10-28T10:00:00.000Z" },
  ];
  m.tables.wa_conv_messages = [
    { conversation_id: "conv1", tenant_id: T, channel_id: CH, role: "user", body: "[comment] Jai Shree RadheKrishan 🙏", created_at: "2026-11-01T05:18:02.574Z" },
    // Same words in another workspace — must never name this workspace's commenter.
    { conversation_id: "conv-x", tenant_id: OTHER, channel_id: CH, role: "user", body: "[comment] Radhey Radhey", created_at: "2026-10-29T14:25:00.000Z" },
  ];
  m.tables.wa_conversations = [
    { id: "conv1", tenant_id: T, channel_id: CH, platform: "instagram", phone: "1118929554184933", name: "@loveyoukrishanluk", avatar_url: "https://cdn/a.jpg", lead_phone: "919800000000" },
    { id: "conv-x", tenant_id: OTHER, channel_id: CH, platform: "instagram", phone: "555", name: "@someone_else", avatar_url: null, lead_phone: null },
  ];
});

describe("filling in who commented", () => {
  it("names the commenter from Live Chat, else from the platform, and marks the rest as looked up", async () => {
    const { history } = await load();
    const r = await history.fillReplyAuthors(Date.now() + 60_000);
    expect(r).toEqual({ filled: 2, looked: 3 });
    const rows = Object.fromEntries(m.tables.wa_comment_replies.map(x => [x.id, x]));
    expect(rows.r1).toMatchObject({ comment_author_id: "1118929554184933", comment_author: "@loveyoukrishanluk" });
    expect(rows.r2).toMatchObject({ comment_author_id: "999", comment_author: "@from_api" });   // not the other workspace's chat
    expect(rows.r3).toMatchObject({ comment_author_id: "", comment_author: null });
    expect(platformAsked).toEqual(["c-api", "c-gone"]);   // Live Chat answered r1 without a platform call
  });

  it("doesn't ask again about rows already looked up", async () => {
    const { history } = await load();
    await history.fillReplyAuthors(Date.now() + 60_000);
    platformAsked = [];
    expect(await history.fillReplyAuthors(Date.now() + 60_000)).toEqual({ filled: 0, looked: 0 });
    expect(platformAsked).toEqual([]);
  });
});

describe("showing the person on the card", () => {
  it("attaches their chat — picture, phone, chat id — by id, and by @handle for older rows", async () => {
    const { replies } = await load();
    const base = { channelId: CH, platform: "instagram" as const, parentCommentId: "c", commentText: "hi", postId: null, replyId: "x", replyText: "thanks", source: "rule" as const, status: "sent" as const, editedAt: null, editedBy: null, createdAt: "2026-11-01T00:00:00Z" };
    const out = await replies.withPeople(T, "instagram", [
      { ...base, id: "a", commentAuthor: null, commentAuthorId: "1118929554184933" },
      { ...base, id: "b", commentAuthor: "@loveyoukrishanluk", commentAuthorId: null },
      { ...base, id: "c", commentAuthor: "@someone_else", commentAuthorId: null },   // another workspace's person
    ]);
    expect(out[0].person).toEqual({ chatPhone: "1118929554184933", name: "@loveyoukrishanluk", avatarUrl: "https://cdn/a.jpg", leadPhone: "919800000000" });
    expect(out[1].commentAuthorId).toBe("1118929554184933");
    expect(out[2].person).toBeUndefined();
  });
});

describe("recording the commenter's id", () => {
  it("keeps the row when the id column isn't there yet", async () => {
    vi.resetModules();
    const writes: Record<string, unknown>[][] = [];
    vi.doMock("../tenantdb", () => ({ tdb: () => ({ from: () => ({ upsert: (rows: Record<string, unknown>[]) => {
      writes.push(rows);
      const error = "comment_author_id" in rows[0] ? { code: "PGRST204", message: "Could not find the 'comment_author_id' column of 'wa_comment_replies'" } : null;
      return Promise.resolve({ error });
    } }) }) }));
    vi.doMock("../channels", () => ({ getChannelById: async () => null }));
    const { recordCommentReply } = await import("../comment-replies");
    await recordCommentReply({ tenantId: T, channelId: CH, platform: "instagram", parentCommentId: "c", replyId: "r", replyText: "thanks", source: "rule", commentAuthor: "@a", commentAuthorId: "123" });
    expect(writes).toHaveLength(2);
    expect(writes[1][0]).not.toHaveProperty("comment_author_id");
    expect(writes[1][0]).toMatchObject({ comment_author: "@a", reply_id: "r" });
  });

  it("every live recording passes the commenter's id", () => {
    const root = path.resolve(__dirname, "../../..");
    for (const f of ["src/app/api/webhooks/instagram/route.ts", "src/app/api/webhooks/messenger/route.ts", "src/lib/ytpoller.ts"]) {
      const calls = fs.readFileSync(path.join(root, f), "utf8").split("\n").filter(l => l.includes("recordCommentReply({"));
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${f}: ${c.trim().slice(0, 80)}`).toContain("commentAuthorId:");
    }
  });
});
