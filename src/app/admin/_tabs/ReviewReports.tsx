"use client";

// Reviews insights (lib/review-reports.ts): Google's own rating and totals, the
// period's reviews and replies, backlog, review requests, a weekly trend, the
// rating history Talko actually recorded, a per-location comparison and
// feedback themes — each figure defined, each gap labelled, nothing invented.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { inp } from "../_shared";
import { DateRange, LoadStatus } from "@/components/date-range";
import { ColumnChart, HBars, SERIES_COLORS, ShowAsTable, TimeChart, tableRows, type ChartPoint, type ChartSeries } from "@/components/charts";
import { customRangeProblem, isoDay, presetByKey, presetOptions, type PresetKey } from "@/lib/analytics-range";
import { fmtDay as fmtShortDay, fmtNum } from "@/lib/format";

interface Loc { id: string | null; name: string; googleRating: number | null; googleTotal: number | null; googleAsOf: string | null; importedTotal: number; importingHistory: boolean; newReviews: number; averageRating: number | null; responseRate: number | null; medianResponseHours: number | null; openComplaints: number }
interface Example { id: string; rating: number; author: string; snippet: string; date: string | null }
interface Report {
  period: { from: string; to: string; days: number };
  locations: Loc[];
  totals: { googleRating: number | null; googleTotal: number | null; importedTotal: number; newReviews: number; averageRating: number | null; distribution: Record<string, number>; responseRate: number | null; medianResponseHours: number | null; unanswered: number; approvalBacklog: number; openComplaints: number; overdue: number };
  requests: { sent: number; opened: number; failed: number; skipped: number; available: boolean };
  weekly: { weekStart: string; reviews: number; averageRating: number | null }[];
  ratingHistory: { day: string; averageRating: number | null; totalReviews: number | null }[];
  ratingHistoryFrom: string | null;
  themes: { reviewsRead: number; insufficient: boolean; themes: { key: string; label: string; mentions: number; positive: number; negative: number; mixed: number; examples: { positive: Example[]; negative: Example[] } }[] };
  notes: string[];
}

/** The windows /api/admin/reviews/report answers: any from/to up to a year. */
const RANGE_OPTIONS = presetOptions(["7d", "30d", "90d", "12m", "custom"]);
const MAX_DAYS = 366;
const day = (t: number) => isoDay(new Date(t));
/** "6 Nov 2026" — Indian day-month order, always with the year. */
const fmtDay = (iso: string | null) => (iso ? fmtShortDay(iso, new Date(0)) : "—");
const WEEK_SERIES: ChartSeries[] = [
  { key: "reviews", label: "Reviews", color: SERIES_COLORS.primary },
  { key: "rating", label: "Average stars", mark: "none", format: n => `${n}★` },
];
const RATING_SERIES: ChartSeries[] = [
  { key: "rating", label: "Google rating", color: SERIES_COLORS.primary, mark: "line", format: n => `${n.toFixed(1)}★` },
  { key: "total", label: "Reviews on Google", mark: "none" },
];
const hours = (h: number | null) => (h == null ? "—" : h < 24 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`);

function Tile({ label, value, sub, def }: { label: string; value: string; sub?: string; def: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-3" title={def}>
      <p className="text-[12px] font-semibold text-ink-600">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink-900 tabular-nums">{value}</p>
      {sub && <p className="text-[12px] text-ink-500">{sub}</p>}
    </div>
  );
}

export function ReviewReports({ locations }: { locations: { id: string; name: string }[] }) {
  const [period, setPeriod] = useState<PresetKey>("30d");
  const [from, setFrom] = useState(day(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(day(Date.now()));
  const [location, setLocation] = useState("");
  const [data, setData] = useState<{ report: Report; definitions: Record<string, string>; canExport: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const days = presetByKey(period)?.days ?? 30;
  const range = useMemo(() => (period === "custom" ? { from, to } : { from: day(Date.now() - (days - 1) * 86_400_000), to: day(Date.now()) }), [period, days, from, to]);
  // Half-typed custom dates aren't sent; the control explains what's wrong.
  const customProblem = period === "custom" ? customRangeProblem(from, to, { maxDays: MAX_DAYS, today: day(Date.now()) }) : null;
  const qs = useMemo(() => new URLSearchParams({ ...range, ...(location ? { location } : {}) }).toString(), [range, location]);

  const load = useCallback(async () => {
    if (customProblem) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/reviews/report?${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "Insights couldn't be loaded."); return; }
      setData(d); setUpdatedAt(Date.now());
    } catch { setError("Couldn't reach Talko — try again."); } finally { setLoading(false); }
  }, [qs, customProblem]);
  useEffect(() => { load(); }, [load]);

  const r = data?.report;
  const def = data?.definitions ?? {};
  const weekPoints: ChartPoint[] = r ? r.weekly.map(w => ({ key: w.weekStart, label: fmtShortDay(w.weekStart), title: `Week of ${fmtDay(w.weekStart)}`, values: { reviews: w.reviews, rating: w.averageRating } })) : [];

  return (
    <section className="space-y-4" aria-label="Review insights">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-semibold text-ink-600 space-y-1">
            <span className="block">Location</span>
            <select className={`${inp} min-h-9 w-48`} value={location} onChange={e => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="manual">Pasted by hand</option>
            </select>
          </label>
          {data?.canExport && (
            <a href={`/api/admin/reviews/export?${qs}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line bg-white px-3 text-[12px] font-semibold text-ink-700 hover:bg-canvas"><Download className="h-3.5 w-3.5" aria-hidden /> Download CSV</a>
          )}
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
          <DateRange options={RANGE_OPTIONS} value={period} onChange={setPeriod}
            custom={{ from, to, maxDays: MAX_DAYS, onChange: (f, t) => { setFrom(f); setTo(t); } }} />
          <LoadStatus loading={loading && !!r} updatedAt={updatedAt} />
        </div>
      </div>

      {error && <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800 flex items-center gap-3" role="alert"><AlertTriangle className="w-4 h-4" aria-hidden /><span className="flex-1">{error}</span><button onClick={load} className="font-bold underline">Try again</button></div>}
      {loading && !r && <p className="text-xs text-ink-600 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading insights…</p>}

      {r && <div aria-busy={loading} className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {r.notes.length > 0 && <ul className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 list-disc pl-6 space-y-0.5">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Tile label="Google rating" value={r.totals.googleRating != null ? `${r.totals.googleRating.toFixed(1)}★` : "Not available"} sub={r.totals.googleTotal != null ? `${fmtNum(r.totals.googleTotal)} reviews on Google` : "After the first sync"} def={def.googleRating} />
          <Tile label="Reviews in Talko" value={fmtNum(r.totals.importedTotal)} sub="All time, imported or pasted" def={def.googleTotal} />
          <Tile label="New reviews" value={fmtNum(r.totals.newReviews)} sub={r.totals.averageRating != null ? `${r.totals.averageRating}★ average` : "No star ratings"} def={def.newReviews} />
          <Tile label="Response rate" value={r.totals.responseRate != null ? `${r.totals.responseRate}%` : "—"} sub={`Median reply ${hours(r.totals.medianResponseHours)}`} def={`${def.responseRate} ${def.responseTime}`} />
          <Tile label="Review requests" value={r.requests.available ? fmtNum(r.requests.sent) : "—"} sub={r.requests.available ? `${fmtNum(r.requests.opened)} opened the link` : "Not set up yet"} def={def.requests} />
          <Tile label="Without a reply" value={fmtNum(r.totals.unanswered)} sub="Right now" def={def.unanswered} />
          <Tile label="Waiting for approval" value={fmtNum(r.totals.approvalBacklog)} def={def.approvalBacklog} />
          <Tile label="Open complaints" value={fmtNum(r.totals.openComplaints)} sub={r.totals.overdue ? `${fmtNum(r.totals.overdue)} past follow-up` : undefined} def={def.openComplaints} />
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          <figure className="rounded-card border border-line bg-white p-4 space-y-2">
            <figcaption className="text-[13px] font-bold text-ink-900">Star ratings · {fmtDay(r.period.from)} – {fmtDay(r.period.to)}</figcaption>
            {r.totals.newReviews === 0 ? <p className="text-[13px] text-ink-600">No reviews were written in this period.</p> : (
              <HBars label="Reviews by star rating" format={fmtNum}
                items={(["5", "4", "3", "2", "1", "unrated"] as const).filter(k => k !== "unrated" || r.totals.distribution.unrated > 0)
                  .map(k => ({ label: k === "unrated" ? "No rating" : `${k}★`, value: r.totals.distribution[k] ?? 0 }))} />
            )}
          </figure>

          <figure className="rounded-card border border-line bg-white p-4 space-y-2">
            <figcaption className="text-[13px] font-bold text-ink-900">New reviews per week</figcaption>
            <ColumnChart points={weekPoints} series={WEEK_SERIES} label="New reviews per week" />
            <p className="text-[12px] text-ink-500">From reviews imported into Talko, by the date each was written. Point at a bar, or Tab to the chart and use the arrow keys, for its numbers.</p>
            <ShowAsTable caption="New reviews per week" columns={["Week", "Reviews", "Average stars"]} rows={tableRows(weekPoints, WEEK_SERIES)} />
          </figure>
        </div>

        <figure className="rounded-card border border-line bg-white p-4 space-y-2">
          <figcaption className="text-[13px] font-bold text-ink-900">Google rating over time</figcaption>
          {r.ratingHistory.length >= 2 ? (() => {
            const pts: ChartPoint[] = r.ratingHistory.filter(p => p.averageRating != null)
              .map(p => ({ key: p.day, label: fmtShortDay(p.day), title: fmtDay(p.day), values: { rating: p.averageRating, total: p.totalReviews } }));
            return (
              <div>
                <TimeChart points={pts} series={RATING_SERIES} label="Google rating over time" height={140} fit yFormat={n => `${n.toFixed(1)}★`} />
                <ShowAsTable caption="Google rating by day" columns={["Day", "Google rating", "Reviews on Google"]} rows={tableRows(pts, RATING_SERIES)} />
              </div>
            );
          })() : (
            <p className="text-[13px] text-ink-600">
              {locations.length > 1 && !location ? "Choose a location to see its Google rating over time." : r.ratingHistoryFrom ? `Talko started recording Google's rating on ${fmtDay(r.ratingHistoryFrom)}. The chart appears once there are two days in this period.` : "Talko records Google's rating once a day from a location's first sync. Earlier history isn't available from Google."}
            </p>
          )}
        </figure>

        {r.locations.length > 0 && (
          <div className="rounded-card border border-line bg-white overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Locations compared</caption>
              <thead className="text-ink-600 text-left"><tr className="border-b border-line">
                <th className="px-3 py-2 font-semibold">Location</th><th className="px-3 py-2 font-semibold text-right">Google</th><th className="px-3 py-2 font-semibold text-right">In Talko</th>
                <th className="px-3 py-2 font-semibold text-right">New</th><th className="px-3 py-2 font-semibold text-right">Avg ★</th><th className="px-3 py-2 font-semibold text-right">Replied</th>
                <th className="px-3 py-2 font-semibold text-right">Median reply</th><th className="px-3 py-2 font-semibold text-right">Open complaints</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {r.locations.map(l => (
                  <tr key={l.id ?? "manual"} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-semibold text-ink-900">{l.name}{l.importingHistory && <span className="block text-[11px] font-normal text-amber-800">Still importing older reviews</span>}</td>
                    <td className="px-3 py-2 text-right">{l.googleRating != null ? `${l.googleRating.toFixed(1)}★ · ${fmtNum(l.googleTotal)}` : "—"}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(l.importedTotal)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(l.newReviews)}</td>
                    <td className="px-3 py-2 text-right">{l.averageRating ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{l.responseRate != null ? `${l.responseRate}%` : "—"}</td>
                    <td className="px-3 py-2 text-right">{hours(l.medianResponseHours)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(l.openComplaints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section className="space-y-2" aria-label="Feedback themes">
          <h3 className="text-xs font-bold text-ink-900">What customers mention</h3>
          {r.themes.insufficient ? (
            <p className="rounded-control bg-canvas px-3 py-2 text-[12px] text-ink-600">Not enough written reviews in this period to find themes ({r.themes.reviewsRead} of the 10 needed). Try a longer period.</p>
          ) : r.themes.themes.length === 0 ? (
            <p className="rounded-control bg-canvas px-3 py-2 text-[12px] text-ink-600">No topic was mentioned in at least 3 of the {r.themes.reviewsRead} reviews in this period.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-2">
              {r.themes.themes.map(t => (
                <div key={t.key} className="rounded-card border border-line bg-white p-3 space-y-1.5">
                  <p className="text-[13px] font-bold text-ink-900">{t.label}</p>
                  <p className="text-[11px] text-ink-600 tabular-nums">Mentioned in {t.mentions} of {r.themes.reviewsRead} reviews · {t.positive} in 4–5★ reviews · {t.negative} in 1–2★ reviews{t.mixed ? ` · ${t.mixed} other` : ""}</p>
                  {[...t.examples.negative, ...t.examples.positive].slice(0, 3).map(ex => (
                    <blockquote key={ex.id} className="border-l-2 border-line pl-2 text-[12px] text-ink-700">“{ex.snippet}” <span className="text-ink-500">— {ex.author}, {ex.rating ? `${ex.rating}★` : "no rating"}</span></blockquote>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-500">Themes are what customers wrote, matched by keywords, with the star rating of each review — a summary of feedback, not a verified finding.</p>
        </section>

        <details className="rounded-control border border-line bg-white px-3 py-2 text-[12px] text-ink-600">
          <summary className="cursor-pointer font-semibold text-ink-700">How these numbers are counted</summary>
          <dl className="mt-2 space-y-1.5">{Object.entries(def).map(([k, v]) => <div key={k}><dt className="sr-only">{k}</dt><dd>{v}</dd></div>)}</dl>
        </details>
      </div>}
    </section>
  );
}
