// The marketing "money shot": a polished, browser-framed Talko AI dashboard
// mockup — pure presentational (no real data), brand #0783fd, server-safe.
// Modelled on a real analytics dashboard: sidebar nav, top bar, an overview
// card with an AI-score ring, a conversations trend area chart, and a row of
// metric cards. Floating accent cards give it the premium SaaS-hero feel.

import {
  Home, MessageSquare, Megaphone, Sparkles, BarChart3, Settings, User,
  Bell, Search, Bot, CheckCheck, TrendingUp, Zap,
} from "lucide-react";

const NAV = [
  { icon: Home, label: "Dashboard", active: true },
  { icon: MessageSquare, label: "Live Chat" },
  { icon: Megaphone, label: "Broadcasts" },
  { icon: Sparkles, label: "AI Hub" },
  { icon: BarChart3, label: "Analytics" },
];

// Smooth cubic area chart with a gradient fill + peak dot.
function TrendArea() {
  const values = [40, 56, 46, 72, 62, 90, 78, 108, 96, 124, 112, 138];
  const W = 540, H = 150, PAD = 12;
  const max = Math.max(...values), n = values.length;
  const pts = values.map((v, i) => ({ x: (i / (n - 1)) * W, y: H - PAD - (v / max) * (H - PAD * 2) }));
  let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2;
    line += ` C ${cx.toFixed(1)} ${pts[i].y.toFixed(1)} ${cx.toFixed(1)} ${pts[i + 1].y.toFixed(1)} ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`;
  }
  const peak = pts[values.indexOf(max)];
  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[110px] w-full sm:h-[140px]">
        <defs>
          <linearGradient id="heroTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0783FD" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0783FD" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill="url(#heroTrend)" />
        <path d={line} fill="none" stroke="#0783FD" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#0783fd] shadow" style={{ left: `${(peak.x / W) * 100}%`, top: peak.y }} />
      <div className="mt-1 flex justify-between text-[8px] font-medium text-slate-300">
        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => <span key={m}>{m}</span>)}
      </div>
    </div>
  );
}

// Circular progress ring (the AI score), 0–10.
function ScoreRing({ score = 9.3 }: { score?: number }) {
  const r = 34, C = 2 * Math.PI * r, frac = score / 10;
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e8eef5" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="#0783fd" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-extrabold text-slate-900">{score}</span>
        <span className="text-[8px] font-medium text-slate-400">AI score</span>
      </div>
    </div>
  );
}

// Semicircle gauge (auto-resolution %).
function Gauge({ pct = 78 }: { pct?: number }) {
  const r = 46, cx = 56, cy = 56, p = pct / 100;
  const end = Math.PI - Math.PI * p;
  const ex = cx + r * Math.cos(end), ey = cy - r * Math.sin(end);
  return (
    <div className="relative">
      <svg viewBox="0 0 112 64" className="w-full">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#e8eef5" strokeWidth="9" strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} fill="none" stroke="#0783fd" strokeWidth="9" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-base font-extrabold text-slate-900">{pct}%</div>
        <div className="text-[8px] text-slate-400">auto-resolved</div>
      </div>
    </div>
  );
}

function MetricCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">{children}</div>;
}

export function TalkoDashboard() {
  return (
    <div className="relative">
      {/* Floating accent cards — the premium SaaS-hero touch */}
      <div className="animate-floaty absolute -left-3 top-16 z-20 hidden rounded-2xl border border-slate-200/80 bg-white/95 px-3.5 py-2.5 shadow-[0_20px_50px_-20px_rgba(7,131,253,0.5)] backdrop-blur sm:block">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366]/10 text-[#1f9d57]"><MessageSquare className="h-4 w-4" /></span>
          <div className="text-left">
            <p className="text-[11px] font-bold text-slate-900">New lead captured</p>
            <p className="text-[10px] text-slate-400">Priya · WhatsApp · just now</p>
          </div>
        </div>
      </div>
      <div className="animate-floaty-delay absolute -right-3 bottom-16 z-20 hidden rounded-2xl border border-slate-200/80 bg-white/95 px-3.5 py-2.5 shadow-[0_20px_50px_-20px_rgba(7,131,253,0.5)] backdrop-blur sm:block">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0783fd]/10 text-[#0783fd]"><Bot className="h-4 w-4" /></span>
          <div className="text-left">
            <p className="text-[11px] font-bold text-slate-900">AI replied in 2s</p>
            <p className="flex items-center gap-1 text-[10px] text-slate-400"><CheckCheck className="h-3 w-3 text-[#0783fd]" /> grounded on your KB</p>
          </div>
        </div>
      </div>

      {/* Browser window */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_50px_140px_-40px_rgba(7,131,253,0.4)]">
        {/* Chrome */}
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <span className="flex gap-1.5">{["#f87171", "#fbbf24", "#34d399"].map(c => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}</span>
          <span className="mx-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500">Built for WhatsApp · Instagram · Messenger teams</span>
        </div>

        <div className="flex">
          {/* Sidebar */}
          <aside className="hidden w-[150px] shrink-0 flex-col border-r border-slate-100 bg-slate-50/40 p-3 sm:flex lg:w-[180px]">
            <div className="flex items-center gap-1.5 px-1.5 pb-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-900 text-white"><Bot className="h-3.5 w-3.5" /></span>
              <span className="text-[13px] font-extrabold tracking-tight text-slate-900">Talko AI</span>
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV.map(n => (
                <span key={n.label} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-semibold ${n.active ? "bg-[#0783fd] text-white shadow-sm" : "text-slate-500"}`}>
                  <n.icon className="h-3.5 w-3.5" /> {n.label}
                </span>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-0.5 border-t border-slate-100 pt-3">
              <span className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-500"><User className="h-3.5 w-3.5" /> Profile</span>
              <span className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-500"><Settings className="h-3.5 w-3.5" /> Settings</span>
            </div>
          </aside>

          {/* Main */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            {/* Top bar */}
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400"><Search className="h-3.5 w-3.5" /> Search conversations…</div>
              <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400"><Bell className="h-4 w-4" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#0783fd]" /></span>
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-900 text-[11px] font-bold text-white">MR</span>
                <span className="hidden text-left lg:block"><span className="block text-[11px] font-bold leading-tight text-slate-900">Moni Roy</span><span className="block text-[9px] leading-tight text-slate-400">Admin</span></span>
              </span>
            </div>

            <h3 className="mt-4 text-base font-extrabold text-slate-900">Conversations Overview</h3>

            {/* Overview + trend */}
            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.5fr]">
              <MetricCard>
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    {[["Conversations", "12,480"], ["Leads captured", "1,284"], ["AI-handled", "92%"]].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-sm font-extrabold text-slate-900">{v}</div>
                        <div className="text-[9px] font-medium text-slate-400">{k}</div>
                      </div>
                    ))}
                  </div>
                  <ScoreRing score={9.3} />
                </div>
              </MetricCard>
              <MetricCard>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-900">Conversations Trend</span>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-600"><TrendingUp className="h-3 w-3" /> +12% vs last month</span>
                </div>
                <TrendArea />
              </MetricCard>
            </div>

            {/* Metric row */}
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <MetricCard>
                <div className="text-[11px] font-bold text-slate-900">AI Resolution</div>
                <div className="mt-2 px-2"><Gauge pct={78} /></div>
              </MetricCard>
              <MetricCard>
                <div className="text-[11px] font-bold text-slate-900">Messages tracked</div>
                <div className="mt-1 text-xl font-extrabold text-slate-900">4,826 <span className="text-[10px] font-bold text-emerald-600">+18%</span></div>
                <div className="mt-2 flex h-12 items-end gap-1.5">
                  {[40, 62, 48, 80, 58, 96].map((h, i) => <span key={i} className={`flex-1 rounded-t ${i === 5 ? "bg-[#0783fd]" : "bg-slate-100"}`} style={{ height: `${h}%` }} />)}
                </div>
              </MetricCard>
              <MetricCard>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-900">CSAT Analyzer</span>
                  <span className="flex items-center gap-1 rounded-full bg-[#0783fd] px-1.5 py-0.5 text-[8px] font-bold text-white"><Zap className="h-2.5 w-2.5" /> Run AI</span>
                </div>
                <div className="mt-1.5 text-[10px] text-slate-500">Your CSAT is <b className="text-slate-900">92%</b> — Excellent</div>
                <div className="mt-2 flex items-end gap-[3px]">
                  {Array.from({ length: 22 }).map((_, i) => <span key={i} className={`h-5 flex-1 rounded-sm ${i < 20 ? "bg-[#0783fd]" : "bg-slate-100"}`} />)}
                </div>
                <div className="mt-1.5 text-[8px] text-slate-400">Based on 1,284 rated chats · updated today</div>
              </MetricCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
