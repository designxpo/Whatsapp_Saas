"use client";

// Campaign history + detail dashboard (funnel, clicks, replies) — extracted from
// admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, Check, ChevronRight, CircleCheck, Loader2, MessageSquare, MousePointerClick, Reply } from "lucide-react";
import { type Tab } from "../_shared";
import { EmptyState } from "../_shared";
import { toast } from "@/components/toast";
import { SERIES_COLORS, ShowAsTable, TimeChart, tableRows, type ChartPoint, type ChartSeries } from "@/components/charts";
import { fmtDay, fmtNum } from "@/lib/format";

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
/** "6 Nov 2026, 4:05 pm" — Indian order, whatever the browser's locale. */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtDay(iso, new Date(0))}, ${timeFmt.format(d).toLowerCase()}`;
}
const DAY_SERIES: ChartSeries[] = [
  { key: "clicked", label: "Clicked", color: SERIES_COLORS.primary, mark: "area" },
  { key: "read", label: "Read", color: SERIES_COLORS.secondary, mark: "dashed" },
  { key: "delivered", label: "Delivered", mark: "none" },
  { key: "sent", label: "Sent", mark: "none" },
];

// ── Campaign history + detail dashboard (funnel, clicks, replies) ─────────────
type Funnel = { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
type DayPoint = { date: string; sent: number; delivered: number; read: number; clicked: number };
type CampaignStats = {
  funnel: Funnel; clicked: number; replied: number; perDay: DayPoint[];
  info: { name: string; templateName: string; sentOn: string; status: string; totalRecipients: number; ctaUrl: string | null; clickTracking: boolean };
};

// Share of recipients who clicked — a labelled bar rather than a ring (lengths
// read more accurately than angles).
function ClickShare({ pct }: { pct: number }) {
  const v = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full">
      <p className="text-3xl font-extrabold text-brand-dark tabular-nums">{Math.round(v)}%</p>
      <p className="text-[12px] font-semibold text-ink-600">of recipients clicked</p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${v > 0 ? Math.max(2, v) : 0}%`, background: SERIES_COLORS.primary }} />
      </div>
    </div>
  );
}

function PerDayChart({ days }: { days: DayPoint[] }) {
  if (days.length === 0) return <p className="text-sm text-ink-500 py-10 text-center">No daily activity yet — it fills in as messages are delivered and read.</p>;
  const points: ChartPoint[] = days.map(d => ({ key: d.date, label: fmtDay(d.date), values: { clicked: d.clicked, read: d.read, delivered: d.delivered, sent: d.sent } }));
  return (
    <>
      <TimeChart points={points} series={DAY_SERIES} label="Clicks and reads per day" height={190} />
      <ShowAsTable caption="Activity per day" columns={["Day", ...DAY_SERIES.map(s => s.label)]} rows={tableRows(points, DAY_SERIES)} />
    </>
  );
}

function CampaignsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [campaigns, setCampaigns] = useState<{ id: string; templateName: string; status: string; totalRecipients: number; sentCount: number; failedCount: number; createdAt: string }[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [retargeting, setRetargeting] = useState(false);
  useEffect(() => { fetch("/api/admin/campaigns").then(r => r.json()).then(d => setCampaigns(d.campaigns ?? [])).catch(() => {}); }, []);

  const loadStats = useCallback((id: string) => {
    fetch(`/api/admin/campaigns/${id}/funnel`).then(r => r.json()).then(d => { if (d.funnel) setStats(d as CampaignStats); }).catch(() => {});
  }, []);
  // Keep the open campaign's insight live — delivery/read receipts arrive over
  // minutes, so poll while the detail is open instead of a one-shot fetch.
  useEffect(() => {
    if (!detailId) return;
    loadStats(detailId);
    const t = setInterval(() => { if (!document.hidden) loadStats(detailId); }, 8000);
    return () => clearInterval(t);
  }, [detailId, loadStats]);

  function openDetail(id: string) {
    setDetailId(id); setStats(null);
  }

  // Pull the segment's recipients and jump to Broadcast prefilled (retargeting).
  async function retarget(campaignId: string, segment: string, label: string) {
    setRetargeting(true);
    try {
      const d = await fetch(`/api/admin/campaigns/${campaignId}/funnel?segment=${segment}`).then(r => r.json());
      const recipients: { phone: string; fullName: string }[] = d.recipients ?? [];
      if (!recipients.length) { toast({ text: `Nobody is in “${label}” right now.`, tone: "info" }); return; }
      sessionStorage.setItem("wa_retarget", JSON.stringify({ note: `Retarget: ${label} (${recipients.length} recipients)`, recipients }));
      goTo("broadcast");
    } catch {
      toast({ text: "Couldn't load that group — check your connection and try again.", tone: "error" });
    } finally { setRetargeting(false); }
  }

  // ── Detail view ──
  if (detailId) {
    const f = stats?.funnel;
    const total = f?.total ?? 0;
    const cumSent = f ? f.sent + f.delivered + f.read : 0;       // status column is exclusive → cumulative for display
    const cumDelivered = f ? f.delivered + f.read : 0;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    const tiles: { label: string; n: number; pct: number; icon: React.ReactNode; hot?: boolean }[] = f ? [
      { label: "Overview", n: total, pct: 100, icon: <BarChart3 className="w-3.5 h-3.5" /> },
      { label: "Sent", n: cumSent, pct: pct(cumSent), icon: <Check className="w-3.5 h-3.5" /> },
      { label: "Delivered", n: cumDelivered, pct: pct(cumDelivered), icon: <CircleCheck className="w-3.5 h-3.5" /> },
      { label: "Read", n: f.read, pct: pct(f.read), icon: <MessageSquare className="w-3.5 h-3.5" /> },
      { label: "Clicked", n: stats!.clicked, pct: pct(stats!.clicked), icon: <MousePointerClick className="w-3.5 h-3.5" />, hot: true },
      { label: "Replied", n: stats!.replied, pct: pct(stats!.replied), icon: <Reply className="w-3.5 h-3.5" /> },
      { label: "Failed", n: f.failed, pct: pct(f.failed), icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    ] : [];
    const SEGMENTS: { label: string; segment: string; n: number }[] = f ? [
      { label: "Read, not replied", segment: "read", n: f.read },
      { label: "Delivered, not read", segment: "delivered_not_read", n: f.delivered },
      { label: "Sent, no receipt", segment: "sent_not_delivered", n: f.sent },
      { label: "Failed", segment: "failed", n: f.failed },
    ] : [];
    return (
      <div className="max-w-4xl space-y-5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setDetailId(null)} aria-label="Back to all campaigns" className="grid place-items-center w-9 h-9 rounded-lg hover:bg-slate-100"><ArrowLeft className="w-5 h-5 text-slate-500" aria-hidden /></button>
          <h2 className="text-xl font-extrabold text-brand-dark uppercase tracking-wide">{stats?.info.name ?? "Campaign"}</h2>
        </div>

        {!stats ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div> : (
          <>
            <div className="bg-white rounded-card border border-line px-2 py-3 flex flex-wrap">
              {tiles.map(t => (
                <div key={t.label} className={`px-4 py-1.5 text-center border-b-2 ${t.hot ? "border-brand-700 bg-brand-50 rounded-t-lg" : "border-transparent"}`}>
                  <p className="text-sm font-extrabold text-brand-dark">{t.pct}% <span className="font-normal text-slate-400 text-xs">({fmtNum(t.n)})</span></p>
                  <p className={`text-[11px] font-semibold flex items-center justify-center gap-1 ${t.hot ? "text-brand-700" : "text-slate-400"}`}>{t.icon}{t.label}</p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-[1fr_200px] gap-5">
              <div className="bg-white rounded-card border border-line p-5 grid grid-cols-2 gap-x-6 gap-y-4">
                <div><p className="text-[12px] font-semibold text-ink-500">Template</p><p className="text-sm font-semibold text-brand-dark font-mono">{stats.info.templateName}</p></div>
                <div><p className="text-[12px] font-semibold text-ink-500">Sent on</p><p className="text-sm font-semibold text-brand-dark">{fmtDateTime(stats.info.sentOn)}</p></div>
                <div><p className="text-[12px] font-semibold text-ink-500">Button link</p><p className="text-sm font-semibold text-brand-dark truncate">{stats.info.ctaUrl ?? "—"}</p></div>
                <div><p className="text-[12px] font-semibold text-ink-500">Recipients</p><p className="text-sm font-semibold text-brand-dark">{fmtNum(stats.info.totalRecipients)} · {stats.info.status}</p></div>
                {!stats.info.clickTracking && <p className="col-span-2 text-[12px] text-ink-500">Click data appears for templates submitted with click tracking enabled.</p>}
              </div>
              <div className="bg-white rounded-card border border-line p-4 flex items-center">
                <ClickShare pct={total ? (stats.clicked / total) * 100 : 0} />
              </div>
            </div>

            <div className="bg-white rounded-card border border-line p-5">
              <h3 className="text-sm font-extrabold text-brand-dark mb-3">Day by day</h3>
              <PerDayChart days={stats.perDay} />
            </div>

            <div className="bg-white rounded-card border border-line p-5 space-y-2">
              <h3 className="text-sm font-extrabold text-brand-dark">Send a follow-up to a group</h3>
              <p className="text-[12px] text-ink-500">Opens Broadcast with these people already added.</p>
              {SEGMENTS.map(s => (
                <div key={s.segment} className="flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="w-40 shrink-0 text-ink-600 font-medium">{s.label}</span>
                  <span className="w-12 font-bold text-ink-700 tabular-nums">{fmtNum(s.n)}</span>
                  {s.n > 0 && (
                    <button disabled={retargeting} onClick={() => retarget(detailId, s.segment, s.label.toLowerCase())}
                      className="min-h-8 px-3 rounded-full border border-brand-dark text-[12px] text-brand-dark font-bold hover:bg-brand-600 hover:text-white disabled:opacity-50">
                      Send a follow-up →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Campaign history</h2><p className="text-sm text-ink-600">Open a broadcast to see who received, read, clicked and replied — and send a follow-up to the people who didn&apos;t.</p>
      </div>
      <div className="space-y-2">
        {campaigns.map(c => (
          <button key={c.id} onClick={() => openDetail(c.id)} className="w-full bg-white rounded-card border border-line p-4 flex items-center justify-between text-left hover:border-brand-dark/40">
            <div><p className="font-mono text-sm font-semibold text-brand-dark">{c.templateName}</p><p className="text-[12px] text-ink-500">{fmtDateTime(c.createdAt)}</p></div>
            <div className="text-right text-xs text-slate-600 flex items-center gap-3">
              <div><span className="px-2 py-0.5 rounded-full bg-slate-100 font-semibold">{c.status}</span><p className="mt-1 tabular-nums">{fmtNum(c.sentCount)} of {fmtNum(c.totalRecipients)} sent{c.failedCount ? ` · ${fmtNum(c.failedCount)} failed` : ""}</p></div>
              <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden />
            </div>
          </button>
        ))}
        {campaigns.length === 0 && (
          <EmptyState mood="sleeping" title="No broadcasts sent yet"
            body="Broadcasts you send appear here with their delivery, read and reply counts."
            action={<button type="button" onClick={() => goTo("broadcast")} className="min-h-9 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-semibold">Send your first broadcast</button>} />
        )}
      </div>
    </div>
  );
}

export default CampaignsTab;
