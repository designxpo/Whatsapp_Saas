"use client";

// Campaign history + detail dashboard (funnel, clicks, replies) — extracted from
// admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, Check, ChevronRight, CircleCheck, Loader2, MessageSquare, MousePointerClick, Reply } from "lucide-react";
import { type Tab } from "../_shared";

// ── Campaign history + detail dashboard (funnel, clicks, replies) ─────────────
type Funnel = { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
type DayPoint = { date: string; sent: number; delivered: number; read: number; clicked: number };
type CampaignStats = {
  funnel: Funnel; clicked: number; replied: number; perDay: DayPoint[];
  info: { name: string; templateName: string; sentOn: string; status: string; totalRecipients: number; ctaUrl: string | null; clickTracking: boolean };
};

function Donut({ pct, label }: { pct: number; label: string }) {
  const r = 42, c = 2 * Math.PI * r;
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 110 110" className="w-32 h-32 -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle cx="55" cy="55" r={r} fill="none" stroke="#0553ad" strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${(Math.min(100, Math.max(0, pct)) / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-extrabold text-brand-dark">{Math.round(pct)}%</span>
        <span className="text-[10px] text-slate-400 font-semibold">{label}</span>
      </div>
    </div>
  );
}

// Per-day area chart (pure SVG — clicked area + read line, AiSensy-style).
function PerDayChart({ days }: { days: DayPoint[] }) {
  if (days.length === 0) return <p className="text-sm text-slate-400 py-10 text-center">No daily activity logged yet.</p>;
  const W = 600, H = 190, PX = 36, PB = 26, PT = 12;
  const maxY = Math.max(1, ...days.map(d => Math.max(d.clicked, d.read, d.delivered)));
  const x = (i: number) => PX + (days.length === 1 ? (W - PX - 8) / 2 : (i * (W - PX - 8)) / (days.length - 1));
  const y = (v: number) => PT + (H - PB - PT) * (1 - v / maxY);
  const path = (key: keyof DayPoint) => days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key] as number).toFixed(1)}`).join(" ");
  const area = `${path("clicked")} L${x(days.length - 1).toFixed(1)},${H - PB} L${x(0).toFixed(1)},${H - PB} Z`;
  const gridY = [0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {gridY.map(g => (
          <g key={g}>
            <line x1={PX} x2={W - 8} y1={y(maxY * g)} y2={y(maxY * g)} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={PX - 5} y={y(maxY * g) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{Math.round(maxY * g)}</text>
          </g>
        ))}
        <path d={area} fill="#0553ad" opacity="0.25" />
        <path d={path("clicked")} fill="none" stroke="#0553ad" strokeWidth="2" />
        <path d={path("read")} fill="none" stroke="#0783fd" strokeWidth="1.5" strokeDasharray="4 3" />
        {days.map((d, i) => i % labelEvery === 0 ? (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </text>
        ) : null)}
      </svg>
      <div className="flex justify-center gap-5 text-[11px] text-slate-500 mt-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-brand-700 inline-block" /> clicked</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-brand-500 inline-block" /> read</span>
      </div>
    </div>
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

  // Pull the segment's recipients and jump to Broadcast prefilled (AiSensy-style retargeting).
  async function retarget(campaignId: string, segment: string, label: string) {
    setRetargeting(true);
    try {
      const d = await fetch(`/api/admin/campaigns/${campaignId}/funnel?segment=${segment}`).then(r => r.json());
      const recipients: { phone: string; fullName: string }[] = d.recipients ?? [];
      if (!recipients.length) { alert(`No recipients in "${label}".`); return; }
      sessionStorage.setItem("wa_retarget", JSON.stringify({ note: `Retarget: ${label} (${recipients.length} recipients)`, recipients }));
      goTo("broadcast");
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
          <button onClick={() => setDetailId(null)} className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft className="w-5 h-5 text-slate-500" /></button>
          <h2 className="text-xl font-extrabold text-brand-dark uppercase tracking-wide">{stats?.info.name ?? "Campaign"}</h2>
        </div>

        {!stats ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div> : (
          <>
            <div className="bg-white rounded-card border border-line px-2 py-3 flex flex-wrap">
              {tiles.map(t => (
                <div key={t.label} className={`px-4 py-1.5 text-center border-b-2 ${t.hot ? "border-brand-700 bg-brand-50 rounded-t-lg" : "border-transparent"}`}>
                  <p className="text-sm font-extrabold text-brand-dark">{t.pct}% <span className="font-normal text-slate-400 text-xs">({t.n.toLocaleString()})</span></p>
                  <p className={`text-[11px] font-semibold flex items-center justify-center gap-1 ${t.hot ? "text-brand-700" : "text-slate-400"}`}>{t.icon}{t.label}</p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-[1fr_200px] gap-5">
              <div className="bg-white rounded-card border border-line p-5 grid grid-cols-2 gap-x-6 gap-y-4">
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Campaign name</p><p className="text-sm font-semibold text-brand-dark font-mono">{stats.info.templateName}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Sent on</p><p className="text-sm font-semibold text-brand-dark">{new Date(stats.info.sentOn).toLocaleString()}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">CTA (URL)</p><p className="text-sm font-semibold text-brand-dark truncate">{stats.info.ctaUrl ?? "—"}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Recipients</p><p className="text-sm font-semibold text-brand-dark">{stats.info.totalRecipients.toLocaleString()} · {stats.info.status}</p></div>
                {!stats.info.clickTracking && <p className="col-span-2 text-[11px] text-slate-400">Click data appears for templates submitted with click tracking enabled.</p>}
              </div>
              <div className="bg-white rounded-card border border-line p-4 flex items-center justify-center">
                <Donut pct={total ? (stats.clicked / total) * 100 : 0} label="clicked" />
              </div>
            </div>

            <div className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-extrabold text-brand-dark mb-3">Audience (per day)</p>
              <PerDayChart days={stats.perDay} />
            </div>

            <div className="bg-white rounded-card border border-line p-5 space-y-2">
              <p className="text-sm font-extrabold text-brand-dark">Smart retargeting</p>
              {SEGMENTS.map(s => (
                <div key={s.segment} className="flex items-center gap-3 text-xs">
                  <span className="w-40 shrink-0 text-slate-500 font-medium">{s.label}</span>
                  <span className="w-12 font-bold text-slate-600">{s.n}</span>
                  {s.n > 0 && (
                    <button disabled={retargeting} onClick={() => retarget(detailId, s.segment, s.label.toLowerCase())}
                      className="px-2 py-0.5 rounded-full border border-brand-dark text-brand-dark font-bold hover:bg-brand-600 hover:text-white">
                      Retarget →
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
        <h2 className="text-xl font-extrabold text-brand-dark">Campaign history</h2>
        <p className="text-sm text-slate-500">Click a campaign for its full dashboard — delivery funnel, clicks, replies, and behavioral retargeting.</p>
      </div>
      <div className="space-y-2">
        {campaigns.map(c => (
          <button key={c.id} onClick={() => openDetail(c.id)} className="w-full bg-white rounded-card border border-line p-4 flex items-center justify-between text-left hover:border-brand-dark/40">
            <div><p className="font-mono text-sm font-semibold text-brand-dark">{c.templateName}</p><p className="text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleString()}</p></div>
            <div className="text-right text-xs text-slate-600 flex items-center gap-3">
              <div><span className="px-2 py-0.5 rounded-full bg-slate-100 font-semibold">{c.status}</span><p className="mt-1">{c.sentCount}/{c.totalRecipients} sent{c.failedCount ? ` · ${c.failedCount} failed` : ""}</p></div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </div>
          </button>
        ))}
        {campaigns.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No campaigns yet.</p>}
      </div>
    </div>
  );
}

export default CampaignsTab;
