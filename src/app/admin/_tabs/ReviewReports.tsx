"use client";

// Reviews insights (lib/review-reports.ts): Google's own rating and totals, the
// period's reviews and replies, backlog, review requests, a weekly trend, the
// rating history Talko actually recorded, a per-location comparison and
// feedback themes — each figure defined, each gap labelled, nothing invented.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { inp } from "../_shared";

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

const PERIODS = [{ d: 7, l: "Last 7 days" }, { d: 30, l: "Last 30 days" }, { d: 90, l: "Last 90 days" }, { d: 365, l: "Last 12 months" }];
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const hours = (h: number | null) => (h == null ? "—" : h < 24 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`);

function Tile({ label, value, sub, def }: { label: string; value: string; sub?: string; def: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-3" title={def}>
      <p className="text-[11px] font-semibold text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink-900 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-ink-500">{sub}</p>}
    </div>
  );
}

export function ReviewReports({ locations }: { locations: { id: string; name: string }[] }) {
  const [period, setPeriod] = useState<number | "custom">(30);
  const [from, setFrom] = useState(day(Date.now() - 29 * 86_400_000));
  const [to, setTo] = useState(day(Date.now()));
  const [location, setLocation] = useState("");
  const [data, setData] = useState<{ report: Report; definitions: Record<string, string>; canExport: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => (period === "custom" ? { from, to } : { from: day(Date.now() - (period - 1) * 86_400_000), to: day(Date.now()) }), [period, from, to]);
  const qs = useMemo(() => new URLSearchParams({ ...range, ...(location ? { location } : {}) }).toString(), [range, location]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/reviews/report?${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "Insights couldn't be loaded."); return; }
      setData(d);
    } catch { setError("Couldn't reach Talko — try again."); } finally { setLoading(false); }
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  const r = data?.report;
  const def = data?.definitions ?? {};
  const maxDist = r ? Math.max(1, ...Object.values(r.totals.distribution)) : 1;
  const maxWeek = r ? Math.max(1, ...r.weekly.map(w => w.reviews)) : 1;

  return (
    <section className="space-y-4" aria-label="Review insights">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-ink-500 space-y-1">
          <span className="block">Period</span>
          <select className={`${inp} w-40`} value={period} onChange={e => setPeriod(e.target.value === "custom" ? "custom" : Number(e.target.value))}>
            {PERIODS.map(p => <option key={p.d} value={p.d}>{p.l}</option>)}
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {period === "custom" && <>
          <label className="text-[11px] font-semibold text-ink-500 space-y-1"><span className="block">From</span><input type="date" className={inp} value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-[11px] font-semibold text-ink-500 space-y-1"><span className="block">To</span><input type="date" className={inp} value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        </>}
        <label className="text-[11px] font-semibold text-ink-500 space-y-1">
          <span className="block">Location</span>
          <select className={`${inp} w-48`} value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="manual">Pasted by hand</option>
          </select>
        </label>
        <div className="flex-1" />
        {data?.canExport && (
          <a href={`/api/admin/reviews/export?${qs}`} className="inline-flex items-center gap-1.5 rounded-control border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-canvas"><Download className="h-3.5 w-3.5" /> Export CSV</a>
        )}
      </div>

      {error && <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800 flex items-center gap-3" role="alert"><AlertTriangle className="w-4 h-4" aria-hidden /><span className="flex-1">{error}</span><button onClick={load} className="font-bold underline">Try again</button></div>}
      {loading && !r && <p className="text-xs text-ink-500 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading insights…</p>}

      {r && <div className={`space-y-4 ${loading ? "opacity-60" : ""}`}>
        {r.notes.length > 0 && <ul className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 list-disc pl-6 space-y-0.5">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Tile label="Google rating" value={r.totals.googleRating != null ? `${r.totals.googleRating.toFixed(1)}★` : "Not available"} sub={r.totals.googleTotal != null ? `${r.totals.googleTotal} reviews on Google` : "After the first sync"} def={def.googleRating} />
          <Tile label="Reviews in Talko" value={String(r.totals.importedTotal)} sub="All time, imported or pasted" def={def.googleTotal} />
          <Tile label="New reviews" value={String(r.totals.newReviews)} sub={r.totals.averageRating != null ? `${r.totals.averageRating}★ average` : "No star ratings"} def={def.newReviews} />
          <Tile label="Response rate" value={r.totals.responseRate != null ? `${r.totals.responseRate}%` : "—"} sub={`Median reply ${hours(r.totals.medianResponseHours)}`} def={`${def.responseRate} ${def.responseTime}`} />
          <Tile label="Review requests" value={r.requests.available ? String(r.requests.sent) : "—"} sub={r.requests.available ? `${r.requests.opened} opened the link` : "Not set up yet"} def={def.requests} />
          <Tile label="Without a reply" value={String(r.totals.unanswered)} sub="Right now" def={def.unanswered} />
          <Tile label="Waiting for approval" value={String(r.totals.approvalBacklog)} def={def.approvalBacklog} />
          <Tile label="Open complaints" value={String(r.totals.openComplaints)} sub={r.totals.overdue ? `${r.totals.overdue} past follow-up` : undefined} def={def.openComplaints} />
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          <figure className="rounded-card border border-line bg-white p-4 space-y-2">
            <figcaption className="text-xs font-bold text-ink-900">Star ratings · {fmtDay(r.period.from)} – {fmtDay(r.period.to)}</figcaption>
            {r.totals.newReviews === 0 ? <p className="text-[12px] text-ink-500">No reviews were written in this period.</p> : (
              <ul className="space-y-1.5" aria-label="Reviews by star rating">
                {(["5", "4", "3", "2", "1", "unrated"] as const).filter(k => k !== "unrated" || r.totals.distribution.unrated > 0).map(k => (
                  <li key={k} className="flex items-center gap-2 text-[12px]" title={`${k === "unrated" ? "No rating" : `${k}★`}: ${r.totals.distribution[k]} reviews`}>
                    <span className="w-14 text-ink-600 tabular-nums">{k === "unrated" ? "No rating" : `${k}★`}</span>
                    <span className="flex-1 h-3 rounded-r bg-canvas" aria-hidden><span className="block h-3 rounded-r bg-brand-600" style={{ width: `${(r.totals.distribution[k] / maxDist) * 100}%` }} /></span>
                    <span className="w-8 text-right text-ink-700 tabular-nums">{r.totals.distribution[k]}</span>
                  </li>
                ))}
              </ul>
            )}
          </figure>

          <figure className="rounded-card border border-line bg-white p-4 space-y-2">
            <figcaption className="text-xs font-bold text-ink-900">New reviews per week</figcaption>
            <div className="flex items-end gap-0.5 h-28" role="img" aria-label={`Reviews per week: ${r.weekly.map(w => `week of ${w.weekStart}, ${w.reviews}`).join("; ")}`}>
              {r.weekly.map(w => (
                <div key={w.weekStart} className="group relative flex-1 flex flex-col justify-end h-full" title={`Week of ${fmtDay(w.weekStart)}: ${w.reviews} review${w.reviews === 1 ? "" : "s"}${w.averageRating != null ? `, ${w.averageRating}★ average` : ""}`}>
                  <div className="rounded-t bg-brand-600" style={{ height: `${Math.max(w.reviews ? 4 : 0, (w.reviews / maxWeek) * 100)}%` }} />
                </div>
              ))}
            </div>
            <p className="flex justify-between text-[10px] text-ink-500 tabular-nums"><span>{fmtDay(r.weekly[0]?.weekStart ?? r.period.from)}</span><span>{fmtDay(r.weekly[r.weekly.length - 1]?.weekStart ?? r.period.to)}</span></p>
            <p className="text-[11px] text-ink-500">From reviews imported into Talko, by the date each was written. Hover a bar for its numbers.</p>
          </figure>
        </div>

        <figure className="rounded-card border border-line bg-white p-4 space-y-2">
          <figcaption className="text-xs font-bold text-ink-900">Google rating over time</figcaption>
          {r.ratingHistory.length >= 2 ? (() => {
            const pts = r.ratingHistory.filter(p => p.averageRating != null) as { day: string; averageRating: number; totalReviews: number | null }[];
            const lo = Math.min(...pts.map(p => p.averageRating)) - 0.1, hi = Math.max(...pts.map(p => p.averageRating)) + 0.1;
            const x = (i: number) => (pts.length === 1 ? 50 : (i / (pts.length - 1)) * 100);
            const y = (v: number) => 90 - ((v - lo) / Math.max(0.01, hi - lo)) * 80;
            return (
              <div>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-28" role="img" aria-label={`Google rating from ${pts[0].averageRating} on ${pts[0].day} to ${pts[pts.length - 1].averageRating} on ${pts[pts.length - 1].day}`}>
                  <polyline fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-brand-600" points={pts.map((p, i) => `${x(i)},${y(p.averageRating)}`).join(" ")} />
                  {pts.map((p, i) => <circle key={p.day} cx={x(i)} cy={y(p.averageRating)} r="1.6" className="fill-brand-700"><title>{`${fmtDay(p.day)}: ${p.averageRating}★${p.totalReviews != null ? ` from ${p.totalReviews} reviews` : ""}`}</title></circle>)}
                </svg>
                <p className="flex justify-between text-[11px] text-ink-600 tabular-nums"><span>{fmtDay(pts[0].day)} · {pts[0].averageRating}★</span><span>{fmtDay(pts[pts.length - 1].day)} · {pts[pts.length - 1].averageRating}★</span></p>
              </div>
            );
          })() : (
            <p className="text-[12px] text-ink-500">
              {locations.length > 1 && !location ? "Choose a location to see its Google rating over time." : r.ratingHistoryFrom ? `Talko started recording Google's rating on ${fmtDay(r.ratingHistoryFrom)}. The chart appears once there are two days in this period.` : "Talko records Google's rating once a day from a location's first sync. Earlier history isn't available from Google."}
            </p>
          )}
        </figure>

        {r.locations.length > 0 && (
          <div className="rounded-card border border-line bg-white overflow-x-auto">
            <table className="w-full text-[12px]">
              <caption className="sr-only">Locations compared</caption>
              <thead className="text-ink-500 text-left"><tr className="border-b border-line">
                <th className="px-3 py-2 font-semibold">Location</th><th className="px-3 py-2 font-semibold text-right">Google</th><th className="px-3 py-2 font-semibold text-right">In Talko</th>
                <th className="px-3 py-2 font-semibold text-right">New</th><th className="px-3 py-2 font-semibold text-right">Avg ★</th><th className="px-3 py-2 font-semibold text-right">Replied</th>
                <th className="px-3 py-2 font-semibold text-right">Median reply</th><th className="px-3 py-2 font-semibold text-right">Open complaints</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {r.locations.map(l => (
                  <tr key={l.id ?? "manual"} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-semibold text-ink-900">{l.name}{l.importingHistory && <span className="block text-[10px] font-normal text-amber-700">Still importing older reviews</span>}</td>
                    <td className="px-3 py-2 text-right">{l.googleRating != null ? `${l.googleRating.toFixed(1)}★ · ${l.googleTotal}` : "—"}</td>
                    <td className="px-3 py-2 text-right">{l.importedTotal}</td>
                    <td className="px-3 py-2 text-right">{l.newReviews}</td>
                    <td className="px-3 py-2 text-right">{l.averageRating ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{l.responseRate != null ? `${l.responseRate}%` : "—"}</td>
                    <td className="px-3 py-2 text-right">{hours(l.medianResponseHours)}</td>
                    <td className="px-3 py-2 text-right">{l.openComplaints}</td>
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
