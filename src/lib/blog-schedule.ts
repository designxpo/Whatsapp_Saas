// Owner control over when blog articles go live, and private preview links.
//
// Articles live in code (src/app/(site)/_content); their publishAt is the
// default. The owner console can publish one early or move its date. That
// choice is stored as one platform setting, { slug: ISO instant }, read on each
// blog request, so it takes effect without a deploy.
//
// A preview link lets the owner (or anyone they send it to) read an article
// before it's public, exactly as it will look. It carries an HMAC of the slug
// and an expiry, signed with ADMIN_JWT_SECRET, so it can't be forged or reused
// for a different article, and it stops working after PREVIEW_TTL_MS.

import { cache } from "react";
import { createHmac, timingSafeEqual } from "crypto";
import { getSetting, setSetting } from "./store";
import { sanitizeOverrides, type PublishOverrides } from "@/app/(site)/_content/blog-publication";

export const BLOG_SCHEDULE_KEY = "blog_publish_overrides";
export const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per request (React cache): metadata and the page share one read. A failed read means "use the times in code". */
export const loadPublishOverrides = cache(async (): Promise<PublishOverrides> => {
  try { return sanitizeOverrides(await getSetting<unknown>(BLOG_SCHEDULE_KEY, {})); }
  catch { return {}; }
});

/** Set (ISO instant) or clear (null) one article's override. Returns the full map. */
export async function setPublishOverride(slug: string, at: string | null): Promise<PublishOverrides> {
  const current = sanitizeOverrides(await getSetting<unknown>(BLOG_SCHEDULE_KEY, {}));
  if (at) current[slug] = new Date(at).toISOString();
  else delete current[slug];
  await setSetting(BLOG_SCHEDULE_KEY, current);
  return current;
}

function previewKey(): string | null {
  const s = process.env.ADMIN_JWT_SECRET;
  return s && s.length >= 32 ? s : null;
}

function sign(slug: string, exp: number, key: string): string {
  return createHmac("sha256", key).update(`blog-preview:${slug}:${exp}`).digest("base64url");
}

export const canSignPreview = (): boolean => previewKey() !== null;

/** A token for /blog/<slug>?preview=<token>, or null when the server can't sign. */
export function signPreview(slug: string, now: number = Date.now()): string | null {
  const key = previewKey();
  if (!key) return null;
  const exp = now + PREVIEW_TTL_MS;
  return `${exp}.${sign(slug, exp, key)}`;
}

export function verifyPreview(slug: string, token: string | null | undefined, now: number = Date.now()): boolean {
  const key = previewKey();
  if (!key || !token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp < now) return false;
  const want = Buffer.from(sign(slug, exp, key));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
