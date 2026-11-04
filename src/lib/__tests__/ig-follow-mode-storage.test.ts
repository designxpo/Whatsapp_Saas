import { beforeEach, describe, expect, it, vi } from "vitest";
import { memdb } from "./helpers/memdb";
const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/memdb").MemDb }));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../moderation", () => ({ assertTextsAllowed: async () => {} }));
vi.mock("../auth", () => ({ currentTenantId: async () => "tenant-a", requireRoleAdmin: async () => true, currentUser: async () => ({}), DEFAULT_TENANT_ID: "default" }));
vi.mock("../channels", () => ({ listChannels: async () => [{ id: "ig-a", kind: "instagram" }] }));
vi.mock("../team", () => ({ logActivity: vi.fn() }));
import { getCommentRule, listCommentRules, saveCommentRule } from "../igcomments";
import { POST } from "../../app/api/admin/ig-comment-rules/route";
const request = (body: unknown) => new Request("https://test/api/admin/ig-comment-rules", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { h.db = memdb(); });

describe("follow-check mode persistence and API", () => {
  it.each(["dm", "comment"] as const)("saves and reloads %s independently per rule and tenant", async mode => {
    const r = await saveCommentRule({ name: "Guide", dmMessage: "Download", requireFollow: true, followCheckMode: mode }, "tenant-a");
    expect(h.db.tables.wa_ig_comment_rules[0].follow_check_mode).toBe(mode);
    expect((await getCommentRule(r.id, "tenant-a"))?.followCheckMode).toBe(mode);
    expect(await getCommentRule(r.id, "tenant-b")).toBeNull();
  });
  it("reads legacy follow rules as DM-first without changing whether follow is required", async () => {
    h.db.tables.wa_ig_comment_rules = [{ id: "old", tenant_id: "tenant-a", require_follow: true }];
    expect((await listCommentRules("tenant-a"))[0]).toMatchObject({ requireFollow: true, followCheckMode: "dm" });
  });
  it("updates the choice and keeps public-only rules outside the follow gate", async () => {
    const r = await saveCommentRule({ requireFollow: true, followCheckMode: "dm" }, "tenant-a");
    expect((await saveCommentRule({ id: r.id, requireFollow: true, followCheckMode: "comment" }, "tenant-a")).followCheckMode).toBe("comment");
    const publicOnly = await saveCommentRule({ replyOnly: true, requireFollow: true, followCheckMode: "comment", publicReplies: ["Thanks"] }, "tenant-a");
    expect(publicOnly).toMatchObject({ requireFollow: false, followCheckMode: "dm" });
  });
  it("accepts both options through the rule endpoint and rejects an invalid mode", async () => {
    for (const followCheckMode of ["dm", "comment"]) {
      const response = await POST(request({ dmMessage: "Download", requireFollow: true, followCheckMode }));
      expect(response.status).toBe(200);
      expect((await response.json()).rule.followCheckMode).toBe(followCheckMode);
    }
    expect((await POST(request({ dmMessage: "Download", followCheckMode: "invalid" }))).status).toBe(400);
    expect(h.db.tables.wa_ig_comment_rules).toHaveLength(2);
  });
});
