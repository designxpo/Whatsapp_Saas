// Owner control over blog publication: publish now / move date / back to the
// original date, the private signed preview link, and that the public blog,
// sitemap and cover images all follow the owner's choice.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  user: { email: "owner@talko.test" } as { email: string } | null,
  audit: [] as { action: string; detail: string }[],
}));

vi.mock("@/lib/store", () => ({
  getSetting: async (k: string, fb: unknown) => (h.settings.has(k) ? h.settings.get(k) : fb),
  setSetting: async (k: string, v: unknown) => { h.settings.set(k, JSON.parse(JSON.stringify(v))); },
}));
vi.mock("@/lib/auth", () => ({
  currentUser: async () => h.user,
  isPlatformOwnerEmail: (e: string | null | undefined) => e === "owner@talko.test",
}));
vi.mock("@/lib/tenants", () => ({
  ownerAudit: async (_e: string, action: string, _t: string | null, detail: string) => { h.audit.push({ action, detail }); },
}));
// React's cache() only dedupes inside a server request; in tests every call reads fresh.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { SCHEDULED_POSTS } from "../../app/(site)/_content/scheduled-posts";
import { POSTS } from "../../app/(site)/_content/site";
import {
  applySchedule, getPostForPreview, getPublishedPost, getPublishedPosts, isPostPublished, sanitizeOverrides,
} from "../../app/(site)/_content/blog-publication";
import { BLOG_SCHEDULE_KEY, PREVIEW_TTL_MS, loadPublishOverrides, signPreview, verifyPreview } from "../blog-schedule";
import { GET, POST } from "../../app/api/owner/blog/route";
import sitemap from "../../app/sitemap";

const post = SCHEDULED_POSTS.at(-1)!;            // the last November article
const release = Date.parse(post.publishAt!);
const before = release - 2 * 86_400_000; // after the previous article, before this one
const LIVE = POSTS.find(p => !p.publishAt)!;     // an older article with no scheduled time

const call = (body: unknown) => POST(new Request("http://x/api/owner/blog", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.settings.clear(); h.audit.length = 0; h.user = { email: "owner@talko.test" };
  process.env.ADMIN_JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
  vi.useFakeTimers(); vi.setSystemTime(before);
});
afterEach(() => vi.useRealTimers());

describe("publication overrides", () => {
  it("publishes early, moves the visible date, and leaves untouched posts as the same object", () => {
    const at = new Date(before - 1000).toISOString();
    const ov = { [post.slug]: at };
    expect(getPublishedPost(post.slug, before)).toBeUndefined();
    const shown = getPublishedPost(post.slug, before, ov)!;
    expect(shown.publishAt).toBe(at);
    expect(shown.date).not.toBe(post.date);
    expect(getPublishedPosts(before, ov)[0].slug).toBe(post.slug);
    expect(applySchedule(LIVE, ov)).toBe(LIVE);
  });

  it("can move a scheduled post later, keeping it private past its original time", () => {
    const later = { [post.slug]: new Date(release + 86_400_000).toISOString() };
    expect(isPostPublished(post, release + 1000, later)).toBe(false);
    expect(isPostPublished(post, release + 1000)).toBe(true);
  });

  it("ignores unknown slugs and invalid times from storage", () => {
    expect(sanitizeOverrides({ [post.slug]: "nope", "not-a-post": new Date().toISOString(), x: 5 })).toEqual({});
    expect(sanitizeOverrides(["a"])).toEqual({});
    expect(sanitizeOverrides(null)).toEqual({});
  });
});

describe("signed preview links", () => {
  it("verifies only for the same article, before expiry, and not when tampered", () => {
    const t = signPreview(post.slug, before)!;
    expect(verifyPreview(post.slug, t, before)).toBe(true);
    expect(verifyPreview(SCHEDULED_POSTS[0].slug, t, before)).toBe(false);
    expect(verifyPreview(post.slug, t, before + PREVIEW_TTL_MS + 1)).toBe(false);
    const [exp, sig] = t.split(".");
    expect(verifyPreview(post.slug, `${Number(exp) + 999_999}.${sig}`, before)).toBe(false);
    expect(verifyPreview(post.slug, "", before)).toBe(false);
    expect(getPostForPreview(post.slug)?.slug).toBe(post.slug);
  });

  it("refuses to sign or verify without a strong server secret", () => {
    const t = signPreview(post.slug, before)!;
    process.env.ADMIN_JWT_SECRET = "short";
    expect(signPreview(post.slug, before)).toBeNull();
    expect(verifyPreview(post.slug, t, before)).toBe(false);
  });
});

describe("owner blog API", () => {
  it("is owner only", async () => {
    h.user = { email: "someone@else.test" };
    expect((await GET()).status).toBe(403);
    expect((await call({ slug: post.slug, action: "publish" })).status).toBe(403);
    h.user = null;
    expect((await GET()).status).toBe(403);
  });

  it("lists scheduled posts with a working preview link and live posts without one", async () => {
    const j = await (await GET()).json();
    const row = j.posts.find((p: { slug: string }) => p.slug === post.slug);
    expect(row.status).toBe("scheduled");
    const token = new URL(row.previewUrl).searchParams.get("preview");
    expect(verifyPreview(post.slug, token, before)).toBe(true);
    const live = j.posts.find((p: { slug: string }) => p.slug === LIVE.slug);
    expect(live.status).toBe("published");
    expect(live.previewUrl).toBeNull();
    expect(j.previewAvailable).toBe(true);
  });

  it("publish now makes the article public on the blog and in the sitemap, and is audited", async () => {
    expect((await sitemap()).some(e => e.url.endsWith(`/blog/${post.slug}`))).toBe(false);
    const r = await call({ slug: post.slug, action: "publish" });
    expect(r.status).toBe(200);
    const ov = await loadPublishOverrides();
    expect(getPublishedPost(post.slug, Date.now(), ov)).toBeDefined();
    expect((await sitemap()).some(e => e.url.endsWith(`/blog/${post.slug}`))).toBe(true);
    expect(h.audit).toEqual([{ action: "blog.publish", detail: post.slug }]);
    // Publishing twice is refused rather than silently moving the date.
    expect((await call({ slug: post.slug, action: "publish" })).status).toBe(409);
  });

  it("back to original date takes an early-published article down again", async () => {
    await call({ slug: post.slug, action: "publish" });
    const r = await call({ slug: post.slug, action: "reset" });
    expect(r.status).toBe(200);
    expect(h.settings.get(BLOG_SCHEDULE_KEY)).toEqual({});
    expect(getPublishedPost(post.slug, Date.now(), await loadPublishOverrides())).toBeUndefined();
    expect((await call({ slug: post.slug, action: "reset" })).status).toBe(409);
  });

  it("moves a scheduled date, refusing past times and live articles", async () => {
    const at = new Date(release + 2 * 86_400_000).toISOString();
    const r = await call({ slug: post.slug, action: "reschedule", at });
    expect(r.status).toBe(200);
    const row = (await r.json()).posts.find((p: { slug: string }) => p.slug === post.slug);
    expect(row).toMatchObject({ publishAt: at, originalAt: post.publishAt, changed: true, status: "scheduled" });
    expect((await call({ slug: post.slug, action: "reschedule", at: new Date(before - 1).toISOString() })).status).toBe(400);
    expect((await call({ slug: post.slug, action: "reschedule", at: "garbage" })).status).toBe(400);
    expect((await call({ slug: LIVE.slug, action: "reschedule", at })).status).toBe(409);
    expect((await call({ slug: LIVE.slug, action: "publish" })).status).toBe(409);
  });

  it("rejects unknown articles and actions", async () => {
    expect((await call({ slug: "no-such-post", action: "publish" })).status).toBe(404);
    expect((await call({ slug: post.slug, action: "delete" })).status).toBe(400);
    expect(h.settings.size).toBe(0);
  });
});
