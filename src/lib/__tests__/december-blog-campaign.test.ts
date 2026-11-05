import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTS } from "../../app/(site)/_content/site";
import { WINTER_FEATURE_POSTS } from "../../app/(site)/_content/winter-feature-posts";
import { getPublishedPost, getPublishedPosts } from "../../app/(site)/_content/blog-publication";
import sitemap from "../../app/sitemap";

// The sitemap reads the owner's publish overrides from the database; none here.
vi.mock("@/lib/blog-schedule", () => ({ loadPublishOverrides: async () => ({}) }));

afterEach(() => vi.useRealTimers());

describe("December 2026 feature campaign", () => {
  it("has exactly eleven December releases with no overlapping old-campaign slots", () => {
    const december = POSTS.filter(post => post.publishAt?.startsWith("2026-12-"));
    expect(december).toEqual(WINTER_FEATURE_POSTS);
    expect(december).toHaveLength(11);
    expect(new Set(POSTS.map(post => post.slug)).size).toBe(POSTS.length);
    expect(december.map(post => post.publishAt)).toEqual(
      Array.from({ length: 11 }, (_, index) => `2026-12-${String(1 + index * 3).padStart(2, "0")}T14:00:00Z`),
    );
    expect(POSTS.find(post => post.slug === "whatsapp-automation-agencies-client-onboarding")?.publishAt)
      .toBe("2026-12-28T14:00:00Z");
    expect(POSTS.find(post => post.slug === "whatsapp-automation-roi-30-day-pilot")?.publishAt)
      .toBe("2026-12-31T14:00:00Z");
  });

  it("releases each finished article into lookup, index and sitemap at its exact instant", async () => {
    vi.useFakeTimers();
    for (const [index, post] of WINTER_FEATURE_POSTS.entries()) {
      const instant = Date.parse(post.publishAt!);
      vi.setSystemTime(instant - 1);
      expect(getPublishedPost(post.slug)).toBeUndefined();
      expect(getPublishedPosts().some(item => item.slug === post.slug)).toBe(false);
      expect((await sitemap()).some(item => item.url.endsWith(`/blog/${post.slug}`))).toBe(false);
      expect(getPublishedPosts().filter(item => WINTER_FEATURE_POSTS.includes(item))).toHaveLength(index);
      vi.setSystemTime(instant);
      expect(getPublishedPost(post.slug)).toBe(post);
      expect(getPublishedPosts()[0]).toBe(post);
      expect((await sitemap()).find(item => item.url.endsWith(`/blog/${post.slug}`))?.lastModified)
        .toEqual(new Date(instant));
      expect(getPublishedPosts().filter(item => WINTER_FEATURE_POSTS.includes(item))).toHaveLength(index + 1);
    }
  });

  it("keeps the two rescheduled articles private on their superseded release dates", () => {
    for (const [slug, instant] of [
      ["whatsapp-automation-agencies-client-onboarding", "2026-12-02T14:00:00Z"],
      ["whatsapp-automation-roi-30-day-pilot", "2026-12-05T14:00:00Z"],
    ]) expect(getPublishedPost(slug, Date.parse(instant))).toBeUndefined();
  });

  it("provides a correctly attributed signup and enquiry path for every article", () => {
    for (const post of WINTER_FEATURE_POSTS) {
      const paragraphs = post.body.filter(block => block.type === "p").map(block => block.text).join(" ");
      expect(paragraphs).toContain(`/signup?blog=${post.slug}`);
      expect(paragraphs).toContain("/pricing");
      expect(post.leadCta).toMatchObject({ campaign: "2026-12-feature-campaign" });
      expect(post.leadCta?.title).toBeTruthy();
      expect(post.leadCta?.label).toBeTruthy();
      expect(post.body.filter(block => block.type === "h2").length).toBeGreaterThanOrEqual(4);
      expect(post.showContents).toBe(true);
    }
  });
});
