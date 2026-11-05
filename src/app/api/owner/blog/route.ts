import { NextResponse } from "next/server";
import { currentUser, isPlatformOwnerEmail } from "@/lib/auth";
import { ownerAudit } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";
import { SITE_URL } from "@/lib/siteurl";
import { canSignPreview, loadPublishOverrides, setPublishOverride, signPreview } from "@/lib/blog-schedule";
import { POSTS } from "@/app/(site)/_content/site";
import { BLOG_ARTWORK } from "@/app/(site)/_content/blog-artwork";
import { applySchedule, isPostPublished, type PublishOverrides } from "@/app/(site)/_content/blog-publication";

export const dynamic = "force-dynamic";

// Blog articles for the owner console: every article with when it goes (or
// went) live, a private preview link for the ones that aren't public yet, and
// three actions — publish now, move the date, or return to the date in code.

export interface BlogRow {
  slug: string; title: string; excerpt: string; category: string; readTime: string;
  status: "published" | "scheduled";
  /** When it goes / went live (with any override applied). Null for older articles with no time. */
  publishAt: string | null;
  /** The time written in the article file, when the owner has changed it. */
  originalAt: string | null;
  changed: boolean;
  cover: string;
  liveUrl: string;
  previewUrl: string | null;
}

function rows(overrides: PublishOverrides, now: number): BlogRow[] {
  return POSTS.map(post => {
    const shown = applySchedule(post, overrides);
    const live = isPostPublished(shown, now);
    const art = BLOG_ARTWORK[post.slug]?.src;
    const token = live ? null : signPreview(post.slug, now);
    const q = token ? `?preview=${encodeURIComponent(token)}` : "";
    return {
      slug: post.slug, title: post.title, excerpt: post.excerpt, category: post.category, readTime: post.readTime,
      status: live ? "published" : "scheduled",
      publishAt: shown.publishAt ?? null,
      originalAt: overrides[post.slug] ? post.publishAt ?? null : null,
      changed: !!overrides[post.slug],
      cover: art ? `${SITE_URL}${art}` : `${SITE_URL}/blog/${post.slug}/cover${q}`,
      liveUrl: `${SITE_URL}/blog/${post.slug}`,
      previewUrl: token ? `${SITE_URL}/blog/${post.slug}${q}` : null,
    };
  });
}

async function owner(): Promise<string | null> {
  const u = await currentUser();
  return u && isPlatformOwnerEmail(u.email) ? u.email : null;
}

export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const now = Date.now();
    return NextResponse.json({ posts: rows(await loadPublishOverrides(), now), previewAvailable: canSignPreview() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

type Action = { slug?: string; action?: "publish" | "reschedule" | "reset"; at?: string };

export async function POST(req: Request) {
  const email = await owner();
  if (!email) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { slug, action, at } = (await req.json().catch(() => ({}))) as Action;
  const post = POSTS.find(p => p.slug === slug);
  if (!post || !slug) return NextResponse.json({ error: "That article doesn't exist." }, { status: 404 });

  try {
    const now = Date.now();
    const overrides = await loadPublishOverrides();
    const live = isPostPublished(applySchedule(post, overrides), now);
    let saved: PublishOverrides;

    if (action === "publish") {
      if (live) return NextResponse.json({ error: "This article is already live." }, { status: 409 });
      saved = await setPublishOverride(slug, new Date(now).toISOString());
      await ownerAudit(email, "blog.publish", null, slug);
    } else if (action === "reschedule") {
      const t = Date.parse(at ?? "");
      if (!Number.isFinite(t)) return NextResponse.json({ error: "Choose a valid date and time." }, { status: 400 });
      if (t <= now + 60_000) return NextResponse.json({ error: "Choose a time in the future, or use Publish now." }, { status: 400 });
      // Moving a live article into the future would take it down and break
      // every link and search result pointing at it.
      if (live) return NextResponse.json({ error: "This article is already live, so its date can't be moved." }, { status: 409 });
      saved = await setPublishOverride(slug, new Date(t).toISOString());
      await ownerAudit(email, "blog.reschedule", null, `${slug} → ${new Date(t).toISOString()}`);
    } else if (action === "reset") {
      if (!overrides[slug]) return NextResponse.json({ error: "This article already uses its original date." }, { status: 409 });
      saved = await setPublishOverride(slug, null);
      await ownerAudit(email, "blog.reset_schedule", null, slug);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, posts: rows(saved, Date.now()) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
