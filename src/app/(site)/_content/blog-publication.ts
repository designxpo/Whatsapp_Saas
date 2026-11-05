import { POSTS, type Post } from "./site";

export function isPostPublished(post: Post, now: number = Date.now()): boolean {
  // Existing articles without a scheduled instant retain their published state.
  return !post.publishAt || Date.parse(post.publishAt) <= now;
}

export function getPublishedPosts(now: number = Date.now()): Post[] {
  return POSTS.filter(post => isPostPublished(post, now)).sort((a, b) =>
    Date.parse(b.publishAt ?? b.date) - Date.parse(a.publishAt ?? a.date));
}

export function getPublishedPost(slug: string, now: number = Date.now()): Post | undefined {
  return POSTS.find(post => post.slug === slug && isPostPublished(post, now));
}

export function getBlogUpdated(fallback: string, now: number = Date.now()): string {
  return getPublishedPosts(now).reduce((latest, post) => {
    const changed = post.dateModified ?? post.publishAt ?? post.date;
    return Date.parse(changed) > Date.parse(latest) ? changed : latest;
  }, fallback);
}
