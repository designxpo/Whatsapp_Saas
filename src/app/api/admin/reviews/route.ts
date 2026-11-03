import { NextResponse } from "next/server";
import { queryReviews, getReview, saveReview, deleteReview, getReviewSettings, getGoogleSyncStatus, REVIEW_VIEWS, type ReviewQuery, type ReviewView, type ReplyStatus } from "@/lib/reviews";
import { listChannels } from "@/lib/channels";
import { currentUser, currentTenantId, requireAdmin, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { visibleChannelIds } from "@/lib/teams";
import { guardFeature } from "@/lib/feature-guard";
import { emailConfigured } from "@/lib/review-alerts";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const STATUSES: ReplyStatus[] = ["none", "draft", "posted"];

// GET — the review inbox: one page of reviews for the chosen view and filters,
// counts for every view, each connected location with its sync health, and the
// workspace's reply settings. ?id=<review> also returns that one review, so an
// alert or email link can open it whatever page it falls on.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  try {
    const sp = new URL(req.url).searchParams;
    const user = await currentUser();
    const allowed = await visibleChannelIds(user);
    const num = (k: string) => { const n = Number(sp.get(k)); return Number.isFinite(n) && n > 0 ? n : undefined; };
    const status = sp.get("status") as ReplyStatus | null;
    const location = sp.get("location");
    const q: ReviewQuery = {
      view: (REVIEW_VIEWS.includes(sp.get("view") as ReviewView) ? sp.get("view") : "all") as ReviewView,
      location: location && (!allowed || allowed.includes(location)) ? location : null,
      rating: num("rating") && num("rating")! <= 5 ? num("rating") : null,
      status: status && STATUSES.includes(status) ? status : null,
      from: /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? sp.get("from") : null,
      to: /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to") : null,
      q: sp.get("q"),
      sort: sp.get("sort") === "oldest_unanswered" ? "oldest_unanswered" : "newest",
      channelIds: allowed,
      page: num("page"),
      pageSize: num("pageSize"),
    };
    const id = sp.get("id");
    const [page, settings, sync, channels, focus] = await Promise.all([
      queryReviews(tid, q),
      getReviewSettings(tid),
      getGoogleSyncStatus(tid),
      listChannels(tid),
      id ? getReview(id, tid) : Promise.resolve(null),
    ]);
    const locations = channels
      .filter(c => c.kind === "google_reviews" && c.active && c.googleLocationId && (!allowed || allowed.includes(c.id)))
      .map(c => {
        const s = sync[c.id];
        // Only what the screen needs: never tokens, never Google's page bookmarks.
        return {
          id: c.id, name: c.name,
          sync: s ? {
            ok: s.ok, error: s.error, kind: s.kind, at: s.at, lastSuccessAt: s.lastSuccessAt, failures: s.failures,
            importingHistory: !!s.highWater && !s.backfillDone,
            averageRating: s.averageRating, totalReviewCount: s.totalReviewCount, mapsUri: s.mapsUri, reviewUri: s.reviewUri,
          } : null,
        };
      });
    const visibleFocus = focus && (!allowed || (focus.channelId && allowed.includes(focus.channelId))) ? focus : null;
    // Members can read the inbox but not change settings; they don't need the
    // admins' alert email addresses.
    const visibleSettings = user?.role === "admin" ? settings : { ...settings, alerts: { ...settings.alerts, recipients: [] } };
    return NextResponse.json({ ...page, focus: visibleFocus, settings: visibleSettings, locations, emailAlertsAvailable: emailConfigured() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — add or edit a review pasted in by hand. Only manual reviews can be
// edited here: a Google review's text comes from Google.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const text = String(body.text ?? "").trim();
  const author = String(body.author ?? "").trim();
  if (!text && !author) return NextResponse.json({ error: "Add the reviewer's name or the review text" }, { status: 400 });
  try {
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id) {
      const existing = await getReview(id, tid);
      if (!existing) return NextResponse.json({ error: "Review not found" }, { status: 404 });
      if (existing.source !== "manual") return NextResponse.json({ error: "A Google review's text comes from Google and can't be edited here." }, { status: 400 });
    }
    const review = await saveReview({
      id, source: "manual",
      locationName: (body.locationName as string | null) ?? null,
      author,
      rating: Math.min(5, Math.max(1, Number(body.rating ?? 5) || 5)),
      text,
    }, tid);
    logActivity(await currentUser(), "settings.save", `review from "${review.author || "anon"}" (${review.rating}★)`);
    return NextResponse.json({ review });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — remove a review by id (scoped to this tenant). The review stays on Google.
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteReview(body.id, tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
