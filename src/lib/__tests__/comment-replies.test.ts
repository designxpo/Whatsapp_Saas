// The reply log behind the "Replies sent" sections. What must hold: every
// public reply is recorded (and a failed record never breaks the reply); a
// correction goes to the platform the right way — YouTube and Facebook edit in
// place, Instagram (which cannot edit a comment) posts the corrected reply
// FIRST and only then removes the old one; nothing acts on another workspace's
// reply or channel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Call = { table: string; op: string; filters: [string, unknown][]; payload?: unknown; opts?: unknown };
const calls: Call[] = [];
let row: Record<string, unknown> | null = null;
let upsertError: { message: string } | null = null;

vi.mock("../tenantdb", () => ({
  tdb: (tenantId: string) => ({
    from: (table: string) => {
      const c: Call = { table, op: "select", filters: [["tenant_id", tenantId]] };
      calls.push(c);
      const b: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
      b.select = chain(() => {});
      b.order = chain(() => {}); b.limit = chain(() => {}); b.lt = chain(() => {});
      b.eq = chain((col, v) => c.filters.push([col as string, v]));
      b.update = chain(p => { c.op = "update"; c.payload = p; });
      b.upsert = (p: unknown, o: unknown) => { c.op = "upsert"; c.payload = p; c.opts = o; return Promise.resolve({ error: upsertError }); };
      b.maybeSingle = () => Promise.resolve({ data: c.op === "update" ? { ...row, ...(c.payload as object) } : row, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: row ? [row] : [], error: null }).then(res);
      return b;
    },
  }),
}));
const channel = { id: "ch1", tenantId: "t1", kind: "youtube", ytChannelId: "UC1", pageId: "PAGE1", igUserId: "IG1", token: "tok" };
vi.mock("../channels", () => ({ getChannelById: vi.fn(async () => channel) }));
vi.mock("../moderation", () => ({ moderateText: vi.fn(async () => ({ allowed: true })) }));
vi.mock("../supabase", () => ({ db: () => ({}) }));

import { recordCommentReply, editCommentReply, deleteCommentReply } from "../comment-replies";

type Req = { url: string; method: string; body?: string };
const reqs: Req[] = [];
let failDelete = false;
beforeEach(() => {
  calls.length = 0; reqs.length = 0; upsertError = null; failDelete = false;
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    reqs.push({ url: String(url), method, body: typeof init.body === "string" ? init.body : undefined });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (String(url).includes("oauth2")) return json(200, { access_token: "at", expires_in: 3600 });
    if (method === "DELETE") return failDelete ? json(400, { error: { message: "nope" } }) : json(200, { success: true });
    if (String(url).endsWith("/replies")) return json(200, { id: "IG_NEW" });
    return json(200, { id: "same" });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const base = { tenant_id: "t1", channel_id: "ch1", parent_comment_id: "C1", comment_text: "hi", comment_author: "@a", post_id: null, reply_id: "R1", reply_text: "old answer", source: "ai", status: "sent", edited_at: null, edited_by: null, created_at: "2026-11-01T00:00:00Z", id: "row1" };

describe("recording a reply", () => {
  it("writes one row per reply, stamped with the workspace, never twice", async () => {
    await recordCommentReply({ tenantId: "t1", channelId: "ch1", platform: "youtube", parentCommentId: "C1", replyId: "R1", replyText: "Thanks!", source: "ai", commentText: "Q?" });
    const c = calls.find(x => x.op === "upsert")!;
    expect((c.payload as unknown[])[0]).toMatchObject({ platform: "youtube", parent_comment_id: "C1", reply_id: "R1", reply_text: "Thanks!", source: "ai" });
    expect(c.opts).toEqual({ onConflict: "platform,reply_id", ignoreDuplicates: true });
  });
  it("skips a reply with no id, and never throws when the log fails", async () => {
    await recordCommentReply({ tenantId: "t1", channelId: "ch1", platform: "instagram", parentCommentId: "C1", replyId: undefined, replyText: "x", source: "ai" });
    expect(calls.length).toBe(0);
    upsertError = { message: "relation wa_comment_replies does not exist" };
    await expect(recordCommentReply({ tenantId: "t1", channelId: "ch1", platform: "instagram", parentCommentId: "C1", replyId: "R", replyText: "x", source: "ai" })).resolves.toBeUndefined();
  });
});

describe("correcting a reply", () => {
  it("YouTube edits the comment in place", async () => {
    row = { ...base, platform: "youtube" };
    const r = await editCommentReply("t1", "row1", "right answer", "me@x.co");
    expect(r.error).toBeUndefined();
    const put = reqs.find(q => q.method === "PUT")!;
    expect(put.url).toContain("youtube/v3/comments?part=snippet");
    expect(JSON.parse(put.body!)).toEqual({ id: "R1", snippet: { textOriginal: "right answer" } });
    const up = calls.find(c => c.op === "update")!;
    expect(up.payload).toMatchObject({ reply_id: "R1", reply_text: "right answer", status: "edited", edited_by: "me@x.co" });
    expect(up.filters).toEqual(expect.arrayContaining([["tenant_id", "t1"], ["id", "row1"]]));
  });
  it("Facebook edits the Page's comment in place", async () => {
    row = { ...base, platform: "facebook" };
    await editCommentReply("t1", "row1", "right answer", "me@x.co");
    const post = reqs.find(q => q.method === "POST")!;
    expect(post.url).toMatch(/graph\.facebook\.com\/v[\d.]+\/R1$/);
    expect(JSON.parse(post.body!)).toEqual({ message: "right answer" });
  });
  it("Instagram posts the corrected reply first, then removes the old one", async () => {
    row = { ...base, platform: "instagram" };
    const r = await editCommentReply("t1", "row1", "right answer", "me@x.co");
    const order = reqs.map(q => `${q.method} ${q.url.split("/").slice(-2).join("/")}`);
    expect(order).toEqual(["POST C1/replies", expect.stringMatching(/^DELETE .*R1$/)]);
    expect(calls.find(c => c.op === "update")!.payload).toMatchObject({ reply_id: "IG_NEW", reply_text: "right answer", status: "edited" });
    expect(r.warning).toBeUndefined();
  });
  it("Instagram: if the old reply won't come down, the correction still stands and says so", async () => {
    row = { ...base, platform: "instagram" };
    failDelete = true;
    const r = await editCommentReply("t1", "row1", "right answer", "me@x.co");
    expect(r.error).toBeUndefined();
    expect(r.warning).toMatch(/corrected reply is up/);
  });
  it("won't touch a reply whose account belongs to another workspace, or one already deleted", async () => {
    row = { ...base, platform: "youtube", tenant_id: "t2" };
    channel.tenantId = "t2";
    expect((await editCommentReply("t1", "row1", "x", "me")).error).toMatch(/no longer connected/);
    channel.tenantId = "t1";
    row = { ...base, platform: "youtube", status: "deleted" };
    expect((await editCommentReply("t1", "row1", "x", "me")).error).toMatch(/was deleted/);
    expect(reqs.length).toBe(0);
  });
});

describe("deleting a reply", () => {
  it("takes it down from the platform and marks it deleted", async () => {
    row = { ...base, platform: "facebook" };
    expect((await deleteCommentReply("t1", "row1", "me@x.co")).error).toBeUndefined();
    expect(reqs.find(q => q.method === "DELETE")!.url).toMatch(/\/R1$/);
    expect(calls.find(c => c.op === "update")!.payload).toMatchObject({ status: "deleted", edited_by: "me@x.co" });
  });
});

describe("every public reply path records itself", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("YouTube: rule, AI and thread follow-up", () => {
    const s = src("src/lib/ytpoller.ts");
    for (const source of ["rule", "ai", "ai_followup"]) expect(s).toMatch(new RegExp(`platform: "youtube"[^}]*source: "${source}"`));
  });
  for (const [file, platform] of [["src/app/api/webhooks/instagram/route.ts", "instagram"], ["src/app/api/webhooks/messenger/route.ts", "facebook"]]) {
    it(`${platform}: AI, public rule paths and thread follow-ups`, () => {
      const s = src(file);
      expect((s.match(new RegExp(`recordCommentReply\\(\\{[^}]*platform: "${platform}"`, "g")) ?? []).length).toBe(platform === "instagram" ? 5 : 4);
      for (const source of ["ai", "rule", "ai_followup"]) expect(s).toMatch(new RegExp(`platform: "${platform}"[^}]*source: "${source}"`));
    });
  }
});
