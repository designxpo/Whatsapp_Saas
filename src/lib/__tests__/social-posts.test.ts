import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  channel: vi.fn(),
  role: "admin",
  feature: true,
}));
vi.mock("../channels", () => ({ getChannel: h.channel }));
vi.mock("../auth", () => ({
  currentUser: async () => (h.role ? { role: h.role, tenantId: "t1" } : null),
  DEFAULT_TENANT_ID: "default",
}));
vi.mock("../feature-guard", () => ({
  guardFeature: async () =>
    h.feature
      ? null
      : Response.json({ error: "Plan required" }, { status: 402 }),
}));
import { listSocialPosts } from "../social-posts";
import { GET } from "../../app/api/admin/social-posts/route";
const fetcher = vi.fn();
const account = {
  id: "ig1",
  kind: "instagram",
  active: true,
  token: "secret-token",
  igUserId: "12345",
  pageId: "54321",
};
beforeEach(() => {
  h.channel.mockReset().mockResolvedValue(account);
  h.role = "admin";
  h.feature = true;
  fetcher.mockReset().mockResolvedValue(Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
const request = (query = "channelId=ig1") =>
  GET(new Request(`https://test/api/admin/social-posts?${query}`));
describe("connected social post picker API", () => {
  it.each(["", "member", "lead"])(
    "blocks %s without requesting posts",
    async (role) => {
      h.role = role;
      expect((await request()).status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("enforces the growth plan", async () => {
    h.feature = false;
    expect((await request()).status).toBe(402);
    expect(h.channel).not.toHaveBeenCalled();
  });
  it("requires an explicit workspace-owned account and never falls back to another account", async () => {
    expect((await request("")).status).toBe(400);
    h.channel.mockResolvedValue(null);
    expect((await request("channelId=foreign")).status).toBe(404);
    expect(h.channel).toHaveBeenLastCalledWith("foreign", "t1");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks disconnected accounts", async () => {
    h.channel.mockResolvedValue({ ...account, active: false });
    expect((await request()).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns Instagram captions, video thumbnails and an opaque next cursor without credentials", async () => {
    fetcher.mockResolvedValue(
      Response.json({
        data: [
          {
            id: "post1",
            caption: "Workshop",
            media_type: "VIDEO",
            media_url: "https://cdn.test/video.mp4",
            thumbnail_url: "https://cdn.test/thumb.jpg",
            permalink: "https://instagram.com/p/one",
            timestamp: "2026-11-01T10:00:00Z",
            access_token: "not-a-response-field",
          },
        ],
        paging: {
          next: "https://untrusted.test/with-secret",
          cursors: { after: "next+/=" },
        },
      }),
    );
    const response = await request();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.posts[0]).toEqual({
      id: "post1",
      caption: "Workshop",
      mediaType: "VIDEO",
      thumbnail: "https://cdn.test/thumb.jpg",
      permalink: "https://instagram.com/p/one",
      timestamp: "2026-11-01T10:00:00Z",
    });
    expect(data.next).toBe("next+/=");
    expect(JSON.stringify(data)).not.toContain("secret");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url).pathname).toMatch(/\/12345\/media$/);
    expect(options.headers.Authorization).toBe("Bearer secret-token");
    expect(options.cache).toBe("no-store");
  });
  it("paginates with a cursor against the original account, never the returned URL", async () => {
    fetcher.mockResolvedValue(
      Response.json({
        data: [],
        paging: { next: "https://evil.test", cursors: { after: "same" } },
      }),
    );
    const data = await listSocialPosts("t1", "ig1", "same");
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("after")).toBe(
      "same",
    );
    expect(data.next).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("loads Facebook Page-owned published posts", async () => {
    h.channel.mockResolvedValue({ ...account, kind: "messenger" });
    fetcher.mockResolvedValue(
      Response.json({
        data: [
          {
            id: "54321_99",
            message: "New offer",
            full_picture: "https://cdn.test/photo.jpg",
            permalink_url: "https://facebook.com/one",
            created_time: "2026-11-01T10:00:00Z",
          },
        ],
      }),
    );
    const data = await listSocialPosts("t1", "fb1");
    expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe(
      "graph.facebook.com",
    );
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toMatch(
      /\/54321\/published_posts$/,
    );
    expect(data.posts[0]).toMatchObject({
      id: "54321_99",
      caption: "New offer",
      thumbnail: "https://cdn.test/photo.jpg",
      mediaType: "POST",
    });
  });
  it("surfaces permission failures rather than pretending the account has no posts", async () => {
    fetcher.mockResolvedValue(
      Response.json({ error: { message: "permission" } }, { status: 403 }),
    );
    const response = await request();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("permissions");
  });
  it("handles a network failure and malformed Graph responses", async () => {
    fetcher.mockRejectedValueOnce(new Error("network"));
    expect((await request()).status).toBe(502);
    fetcher.mockResolvedValueOnce(Response.json(null));
    expect((await request()).status).toBe(502);
  });
  it("rejects oversized cursors before contacting Meta", async () => {
    expect(
      (await request(`channelId=ig1&after=${"a".repeat(4097)}`)).status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
