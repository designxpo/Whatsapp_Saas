"use client";
import { useState, useEffect } from "react";
import { RANGES, type RangeKey } from "@/lib/analytics-range";
type LeadSourcesData = {
  range: string;
  coverage: { chats: number; attributed: number; percent: number; linkOpens: number };
  bySource: { label: string; source: string; medium: string; chats: number; replied: number; handedOver: number }[];
  byLink: { label: string; chats: number; opens: number }[];
  byCampaign: { campaign: string; chats: number }[];
  funnel: { opens: number; chats: number; replied: number; handedOver: number };
};
function LeadSourcesPanel({ d }: { d: LeadSourcesData }) {
  const unattributed = Math.max(0, d.coverage.chats - d.coverage.attributed);
  const thin = d.coverage.percent < 25 && d.coverage.chats > 0;
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
  return (
    <div className="space-y-4">
      {/* Coverage first. Everything below is a slice of `attributed`. */}
      <div className={`rounded-control border px-4 py-3 ${thin ? "border-amber-200 bg-amber-50" : "border-line bg-canvas"}`}>
        <p className={`text-sm font-semibold ${thin ? "text-amber-900" : "text-ink-900"}`}>
          {d.coverage.attributed.toLocaleString()} of {d.coverage.chats.toLocaleString()} chats attributed ({d.coverage.percent}%)
        </p>
        <p className={`text-[11px] mt-0.5 ${thin ? "text-amber-800" : "text-ink-400"}`}>
          {thin
            ? "Most chats carry no campaign reference — they reached the number directly. Everything below describes the attributed slice only."
            : "Everything below describes the attributed chats."}
          {d.coverage.linkOpens > 0 && ` · ${d.coverage.linkOpens.toLocaleString()} short-link opens (all time)`}
        </p>
      </div>

      {/* Funnel — the part GA cannot do, because the conversation lives here. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ["Link opens", d.funnel.opens, null],
          ["Chats started", d.funnel.chats, null],
          ["Replied", d.funnel.replied, pct(d.funnel.replied, d.funnel.chats)],
          ["Handed to sales", d.funnel.handedOver, pct(d.funnel.handedOver, d.funnel.chats)],
        ] as [string, number, number | null][]).map(([label, n, rate]) => (
          <div key={label} className="rounded-control border border-line px-3 py-2">
            <p className="text-[11px] text-ink-400">{label}</p>
            <p className="text-lg font-semibold text-ink-900 tnum">{n.toLocaleString()}</p>
            {rate !== null && <p className="text-[10px] text-ink-400 tnum">{rate}% of chats</p>}
          </div>
        ))}
      </div>

      {/* Source / medium — GA's view, with the spellings collapsed. */}
      <div>
        <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">By source &amp; medium</p>
        <div className="border border-line rounded-control overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-canvas text-ink-400">
              <tr>
                <th className="text-left font-medium px-3 py-1.5">Source</th>
                <th className="text-left font-medium px-3 py-1.5 hidden sm:table-cell">Medium</th>
                <th className="text-right font-medium px-3 py-1.5">Chats</th>
                <th className="text-right font-medium px-3 py-1.5">Replied</th>
                <th className="text-right font-medium px-3 py-1.5">To sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.bySource.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-ink-900 font-medium break-words">{r.label}</td>
                  <td className="px-3 py-1.5 text-ink-400 hidden sm:table-cell">{r.medium}</td>
                  <td className="px-3 py-1.5 text-right tnum text-ink-900">{r.chats.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tnum text-ink-400">{r.replied.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tnum text-ink-400">{r.handedOver.toLocaleString()}</td>
                </tr>
              ))}
              {/* A row, not an omission — the biggest number must stay visible. */}
              {unattributed > 0 && (
                <tr className="bg-canvas">
                  <td className="px-3 py-1.5 text-ink-400 italic">Unattributed</td>
                  <td className="px-3 py-1.5 text-ink-400 hidden sm:table-cell">—</td>
                  <td className="px-3 py-1.5 text-right tnum text-ink-400">{unattributed.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right text-ink-400">—</td>
                  <td className="px-3 py-1.5 text-right text-ink-400">—</td>
                </tr>
              )}
              {d.bySource.length === 0 && unattributed === 0 && (
                <tr><td colSpan={5} className="px-3 py-3 text-center text-ink-400">No chats in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* The tracked links themselves — where the volume actually is today. */}
      {d.byLink.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">By tracked link <span className="normal-case tracking-normal">(all time)</span></p>
          <div className="border border-line rounded-control divide-y divide-line">
            {d.byLink.slice(0, 12).map(l => (
              <div key={l.label} className="px-3 py-1.5 flex items-center justify-between gap-3">
                <span className="text-[12px] text-ink-900 font-medium min-w-0 break-words">{l.label}</span>
                <span className="text-[11px] text-ink-400 tnum shrink-0">{l.chats.toLocaleString()} chats{l.opens > 0 && ` · ${l.opens} opens`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.byCampaign.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">By campaign</p>
          <div className="border border-line rounded-control divide-y divide-line">
            {d.byCampaign.slice(0, 10).map(c => (
              <div key={c.campaign} className="px-3 py-1.5 flex items-center justify-between gap-3">
                <span className="text-[12px] text-ink-900 font-medium min-w-0 break-words">{c.campaign}</span>
                <span className="text-[11px] text-ink-400 tnum shrink-0">{c.chats.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
// `range` is optional: on the Analytics page the dashboard's own picker drives it,
// so the page has ONE window and a heading cannot disagree with the figures under
// it. Mounted without one (anywhere else), the panel keeps its own selector.
export default function TrackedLinkAnalytics({ range: rangeProp }: { range?: RangeKey }) {
 const [ownRange,setRange]=useState<RangeKey>("30d");
 const controlled = rangeProp !== undefined;
 const range = rangeProp ?? ownRange;
 const [data,setData]=useState<LeadSourcesData|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{let active=true;setData(null);setError("");fetch("/api/admin/analytics/sources?range="+range).then(async r=>{const j=await r.json();if(!r.ok||j.error)throw new Error(j.error||"Could not load analytics");return j;}).then(j=>{if(active)setData(j.sources);}).catch(e=>{if(active)setError(String(e.message));});return()=>{active=false;};},[range]);
 return <section className="space-y-4 rounded-card border border-line bg-white p-5"><div className="flex justify-between gap-3"><h2 className="font-semibold">Tracked links & lead sources</h2>{controlled ? <span className="text-xs text-ink-400">{RANGES.find(r=>r.key===range)?.label}</span> : <select value={range} onChange={e=>setRange(e.target.value as RangeKey)}>{RANGES.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select>}</div>{error?<p className="text-red-600">{error}</p>:data?<LeadSourcesPanel d={data}/>:<p>Loading source analytics…</p>}</section>;
}
