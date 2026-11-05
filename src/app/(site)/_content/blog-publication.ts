import { POSTS, type Post } from "./site";

// When each article becomes public. The time written in the article file is the
// default; the owner console can override it per article (publish now, or move
// the date), stored as { slug: ISO instant }. Every function below takes those
// overrides so the pages, the sitemap and the cover images agree.
export type PublishOverrides = Record<string, string>;

const DISPLAY_DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Kolkata" });

/** The post as readers see it: an overridden time also moves its visible date. */
export function applySchedule(post: Post, overrides: PublishOverrides = {}): Post {
  const at = overrides[post.slug];
  if (!at || at === post.publishAt || !Number.isFinite(Date.parse(at))) return post;
  return { ...post, publishAt: at, date: DISPLAY_DATE.format(new Date(at)) };
}

export function isPostPublished(post: Post, now: number = Date.now(), overrides: PublishOverrides = {}): boolean {
  const at = applySchedule(post, overrides).publishAt;
  // Existing articles without a scheduled instant retain their published state.
  return !at || Date.parse(at) <= now;
}

export function getPublishedPosts(now: number = Date.now(), overrides: PublishOverrides = {}): Post[] {
  return POSTS.map(post => applySchedule(post, overrides)).filter(post => isPostPublished(post, now)).sort((a, b) =>
    Date.parse(b.publishAt ?? b.date) - Date.parse(a.publishAt ?? a.date));
}

export function getPublishedPost(slug: string, now: number = Date.now(), overrides: PublishOverrides = {}): Post | undefined {
  const post = POSTS.find(p => p.slug === slug);
  if (!post) return undefined;
  const shown = applySchedule(post, overrides);
  return isPostPublished(shown, now) ? shown : undefined;
}

/** Any article, published or not — only for an owner's signed preview. */
export function getPostForPreview(slug: string, overrides: PublishOverrides = {}): Post | undefined {
  const post = POSTS.find(p => p.slug === slug);
  return post && applySchedule(post, overrides);
}

export function getBlogUpdated(fallback: string, now: number = Date.now(), overrides: PublishOverrides = {}): string {
  return getPublishedPosts(now, overrides).reduce((latest, post) => {
    const changed = post.dateModified ?? post.publishAt ?? post.date;
    return Date.parse(changed) > Date.parse(latest) ? changed : latest;
  }, fallback);
}

/** Keep only overrides for real articles with a valid time; anything else is ignored. */
export function sanitizeOverrides(raw: unknown): PublishOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const slugs = new Set(POSTS.map(p => p.slug));
  const out: PublishOverrides = {};
  for (const [slug, at] of Object.entries(raw as Record<string, unknown>)) {
    if (slugs.has(slug) && typeof at === "string" && Number.isFinite(Date.parse(at))) out[slug] = new Date(at).toISOString();
  }
  return out;
}
