// Review reporting — what's happening with a business's reviews, per location
// and overall, with every figure defined and every gap labelled.
//
// Two different sources, never mixed up:
//   - Google's own figures (current rating, total review count) come from the
//     location's last successful sync, and history of them only exists from
//     the days Talko recorded a snapshot (wa_review_rating_snapshots).
//   - Everything else is counted from the reviews imported into Talko, which
//     can be fewer than Google's total while older reviews are still coming in.
// Review requests are reported next to reviews, never as their cause: Google
// doesn't tell anyone which customer wrote which review.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { listChannels } from "./channels";
import { getGoogleSyncStatus } from "./reviews";
import { summarizeThemes, type ThemeSummary } from "./review-themes";

export const METRIC_DEFINITIONS = {
  googleRating: "Google's current average rating for the location, as of its last sync. Across locations, each is weighted by its review count.",
  googleTotal: "Google's own count of reviews for the location — it can be higher than the reviews imported into Talko.",
  newReviews: "Reviews written in the period (by Google's date), counted from reviews imported into Talko.",
  averageRating: "Average star rating of the reviews written in the period. Reviews without a star rating are left out.",
  responseRate: "Of the reviews written in the period, the share that now have a public reply.",
  responseTime: "Median time from a review being written to its public reply, for replies made on Google (by Talko or directly).",
  unanswered: "Reviews without a public reply right now, whenever they were written.",
  approvalBacklog: "Reviews with a drafted reply waiting for someone to approve it.",
  openComplaints: "Complaint cases not yet resolved.",
  overdue: "Open complaint cases whose follow-up date has passed.",
  requests: "Review requests sent in the period, and how many customers opened the review link. An open doesn't mean a review was written.",
} as const;

export interface LocationRow {
  id: string | null; name: string;
  googleRating: number | null; googleTotal: number | null; googleAsOf: string | null;
  importedTotal: number; importingHistory: boolean;
  newReviews: number; averageRating: number | null; responseRate: number | null; medianResponseHours: number | null;
  openComplaints: number;
}

export interface ReviewReport {
  period: { from: string; to: string; days: number };
  locations: LocationRow[];
  totals: {
    googleRating: number | null; googleTotal: number | null; importedTotal: number;
    newReviews: number; averageRating: number | null; distribution: Record<"1" | "2" | "3" | "4" | "5" | "unrated", number>;
    responseRate: number | null; medianResponseHours: number | null;
    unanswered: number; approvalBacklog: number; openComplaints: number; overdue: number;
  };
  requests: { sent: number; opened: number; failed: number; skipped: number; available: boolean };
  weekly: { weekStart: string; reviews: number; averageRating: number | null }[];
  ratingHistory: { day: string; averageRating: number | null; totalReviews: number | null }[];
  ratingHistoryFrom: string | null;
  themes: ThemeSummary;
  notes: string[];
  truncated: boolean;
}

interface Row {
  id: string; channel_id: string | null; source: string; author: string; rating: number; text: string;
  review_created_at: string | null; created_at: string; reply_status: string; reply_source: string | null; posted_at: string | null;
  is_complaint: boolean | null; case_status: string | null; follow_up_at: string | null;
}

const MAX_ROWS = 5000;
const OPEN = new Set(["new", "in_progress", "waiting_customer"]);
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}
const writtenAt = (r: Row) => r.review_created_at ?? r.created_at;
const inPeriod = (r: Row, from: number, to: number) => { const t = Date.parse(writtenAt(r)); return t >= from && t <= to; };

function periodStats(rows: Row[]) {
  const rated = rows.filter(r => r.rating > 0).map(r => r.rating);
  const replied = rows.filter(r => r.reply_status === "posted");
  const hours = replied
    .filter(r => r.source === "google" && r.posted_at && r.reply_source !== "manual")
    .map(r => (Date.parse(r.posted_at!) - Date.parse(writtenAt(r))) / 3_600_000)
    .filter(h => h >= 0);
  return {
    newReviews: rows.length,
    averageRating: avg(rated),
    responseRate: rows.length ? Math.round((replied.length / rows.length) * 100) : null,
    medianResponseHours: median(hours),
  };
}

/** Monday 00:00 UTC of the week containing `t`. */
function weekStart(t: number): string {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export async function reviewReport(tenantId: string, opts: { from: string; to: string; location?: string | null; channelIds?: string[] | null; now?: number }): Promise<ReviewReport> {
  const now = opts.now ?? Date.now();
  const from = Date.parse(opts.from.length <= 10 ? `${opts.from}T00:00:00Z` : opts.from);
  const to = Date.parse(opts.to.length <= 10 ? `${opts.to}T23:59:59.999Z` : opts.to);
  const notes: string[] = [];

  const [channels, sync] = await Promise.all([listChannels(tenantId), getGoogleSyncStatus(tenantId)]);
  let locs = channels.filter(c => c.kind === "google_reviews" && c.active && c.googleLocationId);
  if (opts.channelIds) locs = locs.filter(c => opts.channelIds!.includes(c.id));
  if (opts.location && opts.location !== "manual") locs = locs.filter(c => c.id === opts.location);

  // Every review this view covers (all time — backlog counts need it), newest first.
  let q = db().from("wa_reviews")
    .select("id,channel_id,source,author,rating,text,review_created_at,created_at,reply_status,reply_source,posted_at,is_complaint,case_status,follow_up_at")
    .eq("tenant_id", tenantId);
  if (opts.location === "manual") q = q.eq("source", "manual");
  else if (opts.location) q = q.eq("channel_id", opts.location);
  if (opts.channelIds) q = q.in("channel_id", opts.channelIds.length ? opts.channelIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q.order("review_created_at", { ascending: false }).limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as unknown as Row[];
  const truncated = all.length >= MAX_ROWS;
  if (truncated) notes.push(`Only the newest ${MAX_ROWS.toLocaleString("en-IN")} reviews are included in these figures.`);
  const period = all.filter(r => inPeriod(r, from, to));

  // Per location.
  const locationRows: LocationRow[] = locs.map(c => {
    const s = sync[c.id];
    const mine = all.filter(r => r.channel_id === c.id);
    if (s?.highWater && !s.backfillDone) notes.push(`${c.name}: older reviews are still being brought in from Google, so Talko's counts for it are incomplete.`);
    return {
      id: c.id, name: c.name,
      googleRating: s?.averageRating ?? null, googleTotal: s?.totalReviewCount ?? null, googleAsOf: s?.ratingAt ?? s?.lastSuccessAt ?? null,
      importedTotal: mine.length, importingHistory: !!s?.highWater && !s?.backfillDone,
      ...periodStats(mine.filter(r => inPeriod(r, from, to))),
      openComplaints: mine.filter(r => r.case_status && OPEN.has(r.case_status)).length,
    };
  });
  const manual = all.filter(r => r.source === "manual");
  if (!opts.location && !opts.channelIds && manual.length) {
    locationRows.push({
      id: null, name: "Pasted by hand", googleRating: null, googleTotal: null, googleAsOf: null,
      importedTotal: manual.length, importingHistory: false,
      ...periodStats(manual.filter(r => inPeriod(r, from, to))),
      openComplaints: manual.filter(r => r.case_status && OPEN.has(r.case_status)).length,
    });
  }

  // Google's overall rating: each location's rating weighted by its count.
  const withGoogle = locationRows.filter(l => l.googleRating != null && l.googleTotal);
  const googleTotal = withGoogle.length ? withGoogle.reduce((a, l) => a + (l.googleTotal ?? 0), 0) : null;
  const googleRating = withGoogle.length && googleTotal
    ? Math.round((withGoogle.reduce((a, l) => a + (l.googleRating ?? 0) * (l.googleTotal ?? 0), 0) / googleTotal) * 100) / 100
    : null;
  if (locs.length && !withGoogle.length) notes.push("Google's rating and total aren't available yet — they appear after a location's first successful sync.");

  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, unrated: 0 } as ReviewReport["totals"]["distribution"];
  for (const r of period) {
    const k = r.rating >= 1 && r.rating <= 5 ? (String(r.rating) as "1") : "unrated";
    distribution[k]++;
  }

  // Weekly trend from reviews in Talko — only weeks inside the period.
  const weeks = new Map<string, number[]>();
  for (let t = from; t <= to; t += 7 * 86_400_000) weeks.set(weekStart(t), []);
  weeks.set(weekStart(to), weeks.get(weekStart(to)) ?? []);
  for (const r of period) { const k = weekStart(Date.parse(writtenAt(r))); weeks.get(k)?.push(r.rating); }
  const weekly = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-26)
    .map(([weekStartDay, ratings]) => ({ weekStart: weekStartDay, reviews: ratings.length, averageRating: avg(ratings.filter(x => x > 0)) }));

  // Google's rating over time — only days Talko actually recorded.
  let ratingHistory: ReviewReport["ratingHistory"] = [];
  let ratingHistoryFrom: string | null = null;
  if (locs.length === 1) {
    const { data: snaps } = await tdb(tenantId).from("wa_review_rating_snapshots").select("day,average_rating,total_review_count")
      .eq("channel_id", locs[0].id).gte("day", new Date(from).toISOString().slice(0, 10)).lte("day", new Date(to).toISOString().slice(0, 10)).order("day", { ascending: true }).limit(400);
    ratingHistory = ((snaps ?? []) as unknown as { day: string; average_rating: number | string | null; total_review_count: number | null }[])
      .map(s => ({ day: String(s.day).slice(0, 10), averageRating: s.average_rating == null ? null : Number(s.average_rating), totalReviews: s.total_review_count }));
    const { data: first } = await tdb(tenantId).from("wa_review_rating_snapshots").select("day").eq("channel_id", locs[0].id).order("day", { ascending: true }).limit(1);
    ratingHistoryFrom = ((first ?? []) as unknown as { day: string }[])[0]?.day?.slice(0, 10) ?? null;
  } else if (locs.length > 1) {
    notes.push("Google's rating over time is shown for one location at a time — choose a location.");
  }

  // Review requests in the period — reported alongside, never as a cause.
  let requests = { sent: 0, opened: 0, failed: 0, skipped: 0, available: true };
  let rq = tdb(tenantId).from("wa_review_requests").select("status,clicked_at,channel_id").gte("created_at", new Date(from).toISOString()).lte("created_at", new Date(to).toISOString()).limit(10000);
  if (opts.location && opts.location !== "manual") rq = rq.eq("channel_id", opts.location);
  const rqRes = await rq;
  if (rqRes.error) requests.available = false;
  else {
    const rr = (rqRes.data ?? []) as unknown as { status: string; clicked_at: string | null }[];
    requests = { sent: rr.filter(r => r.status === "sent").length, opened: rr.filter(r => r.clicked_at).length, failed: rr.filter(r => r.status === "failed").length, skipped: rr.filter(r => r.status === "skipped").length, available: true };
  }

  const p = periodStats(period);
  return {
    period: { from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10), days: Math.max(1, Math.round((to - from) / 86_400_000)) },
    locations: locationRows,
    totals: {
      googleRating, googleTotal, importedTotal: all.length,
      ...p, distribution,
      unanswered: all.filter(r => r.reply_status !== "posted").length,
      approvalBacklog: all.filter(r => r.reply_status === "draft").length,
      openComplaints: all.filter(r => r.case_status && OPEN.has(r.case_status)).length,
      overdue: all.filter(r => r.case_status && OPEN.has(r.case_status) && r.follow_up_at && Date.parse(r.follow_up_at) < now).length,
    },
    requests, weekly, ratingHistory, ratingHistoryFrom,
    themes: summarizeThemes(period.map(r => ({ id: r.id, rating: r.rating, text: r.text, author: r.author, date: writtenAt(r) }))),
    notes: [...new Set(notes)],
    truncated,
  };
}

// ── CSV export ───────────────────────────────────────────────────────────────
/**
 * One spreadsheet cell, safe to open in Excel or Sheets: quoted, and a value
 * starting with = + - @ (or a tab/return) is prefixed with ' so it can never
 * run as a formula. Pure.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
