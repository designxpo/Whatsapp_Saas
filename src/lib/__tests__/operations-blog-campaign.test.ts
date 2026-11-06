import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { POSTS } from "../../app/(site)/_content/site";
import { OPERATIONS_POSTS } from "../../app/(site)/_content/operations-posts";
import { BLOG_ARTWORK } from "../../app/(site)/_content/blog-artwork";
import { getPostForPreview, getPublishedPost, getPublishedPosts } from "../../app/(site)/_content/blog-publication";
import sitemap from "../../app/sitemap";

vi.mock("@/lib/blog-schedule", () => ({ loadPublishOverrides: async () => ({}) }));
afterEach(() => vi.useRealTimers());

describe("January–February operations campaign", () => {
  it("continues the existing December schedule every three days without duplicate slugs", () => {
    const lastDecember = Math.max(...POSTS.filter(p => p.publishAt?.startsWith("2026-12-")).map(p => Date.parse(p.publishAt!)));
    expect(OPERATIONS_POSTS).toHaveLength(19);
    expect(new Set(POSTS.map(p => p.slug)).size).toBe(POSTS.length);
    OPERATIONS_POSTS.forEach((post, i) => {
      expect(Date.parse(post.publishAt!)).toBe(lastDecember + (i + 1) * 3 * 86_400_000);
      expect(post.publishAt).toMatch(/^2027-0[12]-\d{2}T14:00:00Z$/);
    });
  });

  it("keeps every unreleased page out of public lookup and sitemap until its exact release", async () => {
    vi.useFakeTimers();
    for (const post of OPERATIONS_POSTS) {
      const instant = Date.parse(post.publishAt!);
      vi.setSystemTime(instant - 1);
      expect(getPublishedPost(post.slug)).toBeUndefined();
      expect(getPublishedPosts().some(p => p.slug === post.slug)).toBe(false);
      expect((await sitemap()).some(p => p.url.endsWith(`/blog/${post.slug}`))).toBe(false);
      // Owner preview lookup can still find the finished, unpublished article.
      expect(getPostForPreview(post.slug)).toBe(post);
      vi.setSystemTime(instant);
      expect(getPublishedPost(post.slug)).toBe(post);
      expect(getPublishedPosts()[0]).toBe(post);
      expect((await sitemap()).find(p => p.url.endsWith(`/blog/${post.slug}`))?.lastModified).toEqual(new Date(instant));
    }
  });

  it("honours owner publication overrides for a new campaign article", () => {
    const post = OPERATIONS_POSTS[0];
    const early = Date.parse("2026-11-06T14:00:00Z");
    const overrides = { [post.slug]: new Date(early).toISOString() };
    expect(getPublishedPost(post.slug, early)).toBeUndefined();
    expect(getPublishedPost(post.slug, early, overrides)?.publishAt).toBe(overrides[post.slug]);
  });

  it("ships usable art, source evidence, worksheet steps and existing attributed lead routes", () => {
    for (const post of OPERATIONS_POSTS) {
      const artwork = BLOG_ARTWORK[post.slug];
      expect(artwork?.alt).toBeTruthy();
      expect(existsSync(path.join(process.cwd(), "public", artwork.src))).toBe(true);
      expect(post.sources?.every(source => source.href.startsWith("https://"))).toBe(true);
      expect(post.sources?.length).toBeGreaterThan(0);
      const checklist = post.body.find(block => block.type === "checklist");
      expect(checklist?.type === "checklist" && checklist.items.length >= 4).toBe(true);
      const copy = post.body.filter(block => block.type === "p").map(block => block.text).join(" ");
      expect(copy).toContain(`/signup?blog=${post.slug}`);
      expect(copy).toContain("/pricing");
      expect(post.leadCta?.campaign).toBe("2027-01-02-operations");
      for (const slug of post.relatedSlugs ?? []) expect(POSTS.some(candidate => candidate.slug === slug)).toBe(true);
    }
  });
});
