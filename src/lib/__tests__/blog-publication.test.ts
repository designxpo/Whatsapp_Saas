import { afterEach, describe, expect, it, vi } from "vitest";
import { SCHEDULED_POSTS } from "../../app/(site)/_content/scheduled-posts";
import { getBlogUpdated, getPublishedPost, getPublishedPosts, isPostPublished } from "../../app/(site)/_content/blog-publication";
import { blogSourceFromSearch } from "../analytics";
import sitemap from "../../app/sitemap";

afterEach(() => vi.useRealTimers());

describe("finite blog publication campaign", () => {
  it("has ten distinct articles exactly three days apart at 14:00 UTC", () => {
    expect(SCHEDULED_POSTS).toHaveLength(10);
    expect(new Set(SCHEDULED_POSTS.map(p => p.slug)).size).toBe(10);
    expect(SCHEDULED_POSTS[0].publishAt).toBe("2026-11-08T14:00:00Z");
    expect(SCHEDULED_POSTS.at(-1)?.publishAt).toBe("2026-12-05T14:00:00Z");
    SCHEDULED_POSTS.forEach((post, index) => {
      expect(post.publishAt).toMatch(/T14:00:00Z$/);
      expect(post.leadCta?.label).toBeTruthy();
      if (index) expect(Date.parse(post.publishAt!) - Date.parse(SCHEDULED_POSTS[index - 1].publishAt!))
        .toBe(3 * 24 * 60 * 60 * 1000);
    });
  });

  it("keeps each future article out of lookup, index and sitemap until its exact release instant", () => {
    vi.useFakeTimers();
    for (const post of SCHEDULED_POSTS) {
      const release = Date.parse(post.publishAt!);
      vi.setSystemTime(release - 1);
      expect(getPublishedPost(post.slug)).toBeUndefined();
      expect(getPublishedPosts().some(p => p.slug === post.slug)).toBe(false);
      expect(sitemap().some(e => e.url.endsWith(`/blog/${post.slug}`))).toBe(false);
      vi.setSystemTime(release);
      expect(getPublishedPost(post.slug)).toBe(post);
      expect(getPublishedPosts()[0]).toBe(post);
      expect(sitemap().find(e => e.url.endsWith(`/blog/${post.slug}`))?.lastModified)
        .toEqual(new Date(release));
      expect(getBlogUpdated("2026-11-05")).toBe(post.publishAt);
    }
  });

  it("preserves existing articles and fails closed for an invalid scheduled date", () => {
    const existing = getPublishedPost("ai-customer-service-vs-human-support", Date.parse("2026-11-05T20:00:00Z"));
    expect(existing).toBeDefined();
    expect(isPostPublished({ ...SCHEDULED_POSTS[0], publishAt: "invalid" })).toBe(false);
  });

  it("accepts bounded article slugs for lead attribution and rejects arbitrary query text", () => {
    expect(blogSourceFromSearch("?blog=whatsapp-automation-roi-30-day-pilot")).toBe("whatsapp-automation-roi-30-day-pilot");
    for (const search of ["", "?blog=", "?blog=user%40example.com", "?blog=https://example.com", "?blog=../../admin", `?blog=${"a".repeat(121)}`]) {
      expect(blogSourceFromSearch(search)).toBeUndefined();
    }
  });
});
