"use client";

// Analytics tab (lightweight SVG charts + exec brief) — extracted from the
// monolithic admin/page.tsx and lazy-loaded as its own chunk. Logic unchanged.

import { useState, useEffect } from "react";
import { AlertTriangle, CircleCheck, Database, Loader2, MessageSquare, Send, Sparkles, TrendingUp, Users, Zap } from "lucide-react";
import { type AnalyticsData, type Conversation } from "../_shared";

// ── Lightweight SVG charts (no chart library) ────────────────────────────────
function buildArea(values: number[], w: number, h: number, pad: number) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => ({
    x: n <= 1 ? w / 2 : (i / (n - 1)) * w,
    y: h - pad - (v / max) * (h - pad * 2),
  }));
  let line = pts.length ? `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` : "";
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2;
    line += ` C ${cx.toFixed(1)} ${pts[i].y.toFixed(1)} ${cx.toFixed(1)} ${pts[i + 1].y.toFixed(1)} ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`;
  }
  return { pts, line, area: pts.length ? `${line} L ${w} ${h} L 0 ${h} Z` : "", max };
}

// Smooth area/line chart with a highlighted peak (HTML overlay keeps the dot +
// tooltip crisp while the line stretches to full width).
function AreaChart({ daily }: { daily: AnalyticsData["daily"] }) {
  const W = 720, H = 200, PAD = 18;
  const values = daily.map(d => d.sent);
  const { pts, line, area, max } = buildArea(values, W, H, PAD);
  const peakIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
  const peak = peakIdx >= 0 ? pts[peakIdx] : null;
  const grid = [0, 0.5, 1].map(f => H - PAD - f * (H - PAD * 2));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
        <defs>
          <linearGradient id="waArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0783FD" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0783FD" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((y, i) => <line key={i} x1="0" y1={y} x2={W} y2={y} stroke="#EEF2F7" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {area && <path d={area} fill="url(#waArea)" />}
        {line && <path d={line} fill="none" stroke="#0783FD" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {peak && max > 1 && <line x1={peak.x} y1={peak.y} x2={peak.x} y2={H} stroke="#0783FD" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {peak && max > 1 && (
        <>
          <span className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-700 shadow" style={{ left: `${(peak.x / W) * 100}%`, top: peak.y }} />
          <span className="absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[10px] font-bold text-white shadow-lg" style={{ left: `${(peak.x / W) * 100}%`, top: peak.y - 8 }}>
            {values[peakIdx].toLocaleString()} · {daily[peakIdx]?.date.slice(5)}
          </span>
        </>
      )}
      <div className="mt-2 flex justify-between text-[9px] text-ink-400">
        {daily.filter((_, i) => i % 2 === 0 || i === daily.length - 1).map(d => <span key={d.date}>{d.date.slice(5)}</span>)}
      </div>
    </div>
  );
}

// Donut with center label + legend (delivery breakdown of the last 14 days).
function DeliveryDonut({ segments, centerValue, centerLabel }: { segments: { label: string; value: number; color: string }[]; centerValue: string; centerLabel: string }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const R = 56, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#F1F5F9" strokeWidth="16" />
          {segments.map((s, i) => {
            const len = (s.value / total) * C;
            const el = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`} strokeDashoffset={(-offset).toFixed(2)} />;
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold text-ink-900 tnum leading-none">{centerValue}</span>
          <span className="text-[10px] text-ink-400 mt-1">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex-1 space-y-2.5">
        {segments.map(s => (
          <li key={s.label} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-2 text-ink-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="font-bold text-ink-900 tnum">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ExecBrief = { health: "strong" | "steady" | "at-risk"; headline: string; working: string[]; lacking: string[]; steps: { action: string; why: string }[] };

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [brief, setBrief] = useState<ExecBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/analytics").then(r => r.json()).then(d => { setData(d.analytics ?? null); setNotice(d.notice ?? null); }).catch(() => {});
  }, []);

  async function genBrief() {
    setBriefBusy(true); setBriefErr(null);
    try {
      const d = await fetch("/api/admin/analytics/brief", { method: "POST" }).then(r => r.json());
      if (d.brief) setBrief(d.brief); else setBriefErr(d.error || "Could not generate the brief.");
    } catch { setBriefErr("Connection error."); }
    finally { setBriefBusy(false); }
  }

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
  const sumWeek = (rows: { sent: number; delivered: number; read: number; failed: number }[]) =>
    rows.reduce((a, x) => ({ sent: a.sent + x.sent, delivered: a.delivered + x.delivered, read: a.read + x.read, failed: a.failed + x.failed }), { sent: 0, delivered: 0, read: 0, failed: 0 });
  const wow = data ? (() => {
    const prev = sumWeek(data.daily.slice(0, 7)), cur = sumWeek(data.daily.slice(7));
    const dpct = prev.sent > 0 ? Math.round(((cur.sent - prev.sent) / prev.sent) * 100) : (cur.sent > 0 ? 100 : 0);
    return { prev, cur, dpct };
  })() : null;
  const r0 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const healthStyle = (h: string) => h === "strong" ? "bg-brand-100 text-brand-700" : h === "at-risk" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";

  // Secondary KPIs (the first metric is the green hero card below).
  const cards: { label: string; value: string; sub?: string; icon: React.ReactNode }[] = data ? [
    { label: "Sent today", value: data.messaging.sentToday.toLocaleString(), sub: `cap ${process.env.NEXT_PUBLIC_WA_DAILY_LIMIT ?? "900"}`, icon: <Send className="w-[18px] h-[18px]" /> },
    { label: "Delivery rate", value: pct(data.messaging.totals.delivered, data.messaging.totals.sent), sub: `${data.messaging.totals.delivered.toLocaleString()} delivered (14d)`, icon: <CircleCheck className="w-[18px] h-[18px]" /> },
    { label: "Read rate", value: pct(data.messaging.totals.read, data.messaging.totals.sent), sub: `${data.messaging.totals.read.toLocaleString()} read (14d)`, icon: <MessageSquare className="w-[18px] h-[18px]" /> },
    { label: "Campaigns", value: data.campaigns.total.toLocaleString(), sub: `${data.campaigns.automations} automations`, icon: <Send className="w-[18px] h-[18px]" /> },
    { label: "Conversations", value: data.conversations.total.toLocaleString(), sub: `${data.conversations.escalated} escalated · ${data.conversations.needsReply} awaiting`, icon: <MessageSquare className="w-[18px] h-[18px]" /> },
    { label: "Failed (14d)", value: data.messaging.totals.failed.toLocaleString(), icon: <AlertTriangle className="w-[18px] h-[18px]" /> },
    { label: "KB documents", value: data.kb.documents.toLocaleString(), sub: `${data.kb.ready} ready`, icon: <Database className="w-[18px] h-[18px]" /> },
  ] : [];

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Analytics overview</h2>
        <p className="text-[13px] text-ink-400">Messaging performance across WhatsApp &amp; Instagram</p>
      </div>
      {notice && <div className="bg-amber-50 border border-amber-200 rounded-control px-4 py-3 text-sm text-amber-800">{notice}</div>}
      {data && (
        <>
          {/* ── CEO executive overview: week-over-week + AI brief ── */}
          <section className="rounded-card border border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-brand-700" /> Executive overview</p>
                <p className="text-[11px] text-ink-400">This week vs last — with an AI read on what to fix.</p>
              </div>
              <button onClick={genBrief} disabled={briefBusy} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                {briefBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {brief ? "Refresh brief" : "Generate brief"}
              </button>
            </div>

            {wow && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Sent this week", value: wow.cur.sent.toLocaleString(), delta: wow.dpct },
                  { label: "Read rate", value: `${r0(wow.cur.read, wow.cur.sent)}%`, delta: r0(wow.cur.read, wow.cur.sent) - r0(wow.prev.read, wow.prev.sent) },
                  { label: "Delivery rate", value: `${r0(wow.cur.delivered, wow.cur.sent)}%`, delta: r0(wow.cur.delivered, wow.cur.sent) - r0(wow.prev.delivered, wow.prev.sent) },
                  { label: "Failures", value: wow.cur.failed.toLocaleString(), delta: wow.cur.failed - wow.prev.failed, invert: true },
                ].map(k => {
                  const up = k.delta > 0, flat = k.delta === 0;
                  const good = k.invert ? !up : up;
                  return (
                    <div key={k.label} className="bg-white rounded-control border border-line p-3">
                      <p className="text-[19px] font-bold text-ink-900 tnum leading-none">{k.value}</p>
                      <p className="text-[11px] text-ink-500 font-medium mt-1">{k.label}</p>
                      <p className={`text-[10px] font-bold mt-0.5 ${flat ? "text-ink-400" : good ? "text-brand-700" : "text-red-600"}`}>
                        {flat ? "no change" : `${up ? "▲" : "▼"} ${Math.abs(k.delta)}${k.label.includes("rate") ? "pp" : ""} vs last week`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {briefErr && <p className="text-xs text-red-600">{briefErr}</p>}
            {!brief && !briefBusy && !briefErr && <p className="text-xs text-ink-500">Tap <b>Generate brief</b> for an AI read of the whole platform — what&apos;s working, what&apos;s lacking, and the highest-impact next steps.</p>}
            {briefBusy && !brief && <p className="text-xs text-ink-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing this week&apos;s performance…</p>}
            {brief && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${healthStyle(brief.health)}`}>{brief.health === "strong" ? "🟢 Strong" : brief.health === "at-risk" ? "🔴 At risk" : "🟡 Steady"}</span>
                  <p className="text-sm font-semibold text-ink-900">{brief.headline}</p>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="bg-white rounded-control border border-line p-3">
                    <p className="text-[11px] font-bold text-brand-700 uppercase mb-1.5">What&apos;s working</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-ink-700">{brief.working.map((w, i) => <li key={i}>{w}</li>)}{!brief.working.length && <li className="list-none text-ink-400">—</li>}</ul>
                  </div>
                  <div className="bg-white rounded-control border border-line p-3">
                    <p className="text-[11px] font-bold text-red-600 uppercase mb-1.5">What&apos;s lacking</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-ink-700">{brief.lacking.map((w, i) => <li key={i}>{w}</li>)}{!brief.lacking.length && <li className="list-none text-ink-400">—</li>}</ul>
                  </div>
                </div>
                {brief.steps.length > 0 && (
                  <div className="bg-white rounded-control border border-line p-3">
                    <p className="text-[11px] font-bold text-ink-500 uppercase mb-1.5">Do next — in priority order</p>
                    <ol className="space-y-2">
                      {brief.steps.map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-brand-700 text-white font-bold flex items-center justify-center text-[10px]">{i + 1}</span>
                          <span><span className="font-semibold text-ink-900">{s.action}</span>{s.why ? <span className="text-ink-500"> — {s.why}</span> : null}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <p className="text-[10px] text-ink-400">AI-generated from your metrics — sanity-check before acting.</p>
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Green hero card — the one signature green surface per the brief. */}
            <div className="relative overflow-hidden rounded-card p-5 bg-gradient-to-br from-brand-600 to-brand-900 text-white">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-control bg-white/15 flex items-center justify-center"><Users className="w-[18px] h-[18px]" /></div>
              </div>
              <p className="text-[28px] font-bold mt-3 leading-none tnum">{data.contacts.active.toLocaleString()}</p>
              <p className="text-[13px] font-medium text-white/80 mt-1.5">Active contacts</p>
              <p className="text-[11px] text-white/60 mt-0.5">{data.contacts.optedOut.toLocaleString()} opted out</p>
            </div>
            {cards.map(c => (
              <div key={c.label} className="bg-white rounded-card border border-line p-5 transition-colors hover:border-[#D4D4D8]">
                <div className="w-9 h-9 rounded-control bg-brand-50 text-brand-700 flex items-center justify-center">{c.icon}</div>
                <p className="text-[28px] font-bold text-ink-900 mt-3 leading-none tnum tracking-[-0.02em]">{c.value}</p>
                <p className="text-[13px] font-medium text-ink-600 mt-1.5">{c.label}</p>
                {c.sub && <p className="text-[11px] text-ink-400 mt-0.5">{c.sub}</p>}
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Messages trend — smooth area chart with peak callout */}
            <section className="lg:col-span-2 bg-white rounded-card border border-line p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Messages sent</p>
                  <p className="text-[12px] text-ink-400">Last 14 days · {data.messaging.totals.sent.toLocaleString()} total</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">{pct(data.messaging.totals.delivered, data.messaging.totals.sent)} delivered</span>
              </div>
              <AreaChart daily={data.daily} />
            </section>

            {/* Delivery breakdown — donut */}
            <section className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-semibold text-ink-900 mb-5">Delivery breakdown</p>
              <DeliveryDonut
                centerValue={pct(data.messaging.totals.delivered, data.messaging.totals.sent)}
                centerLabel="delivered"
                segments={[
                  { label: "Read", value: data.messaging.totals.read, color: "#0783FD" },
                  { label: "Delivered", value: Math.max(0, data.messaging.totals.delivered - data.messaging.totals.read), color: "#4DA3FF" },
                  { label: "Pending", value: Math.max(0, data.messaging.totals.sent - data.messaging.totals.delivered - data.messaging.totals.failed), color: "#CFE6FF" },
                  { label: "Failed", value: data.messaging.totals.failed, color: "#F97066" },
                ]}
              />
            </section>
          </div>

          {/* ── Engagement funnel: sent → delivered → read → replied ── */}
          <section className="bg-white rounded-card border border-line p-5">
            <p className="text-sm font-semibold text-ink-900 mb-1">Engagement funnel <span className="font-normal text-ink-400">— last 14 days</span></p>
            <p className="text-[11px] text-ink-400 mb-4">How far your messages travel — and where people drop off.</p>
            {(() => {
              const t = data.messaging.totals;
              const base = Math.max(1, t.sent);
              const stages = [
                { label: "Sent", n: t.sent, color: "bg-brand-700" },
                { label: "Delivered", n: t.delivered, color: "bg-brand-600" },
                { label: "Read", n: t.read, color: "bg-brand-500" },
                { label: "Replied", n: data.messaging.replied14d, color: "bg-brand-400" },
              ];
              return (
                <div className="space-y-2">
                  {stages.map((s, i) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-ink-600 shrink-0">{s.label}</span>
                      <div className="flex-1 bg-canvas rounded-full h-5 overflow-hidden"><div className={`${s.color} h-full rounded-full transition-all`} style={{ width: `${Math.max(2, (s.n / base) * 100)}%` }} /></div>
                      <span className="w-24 text-right text-xs tnum shrink-0">{s.n.toLocaleString()}{i > 0 && <span className="text-ink-400"> · {r0(s.n, base)}%</span>}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-1.5"><MessageSquare className="w-4 h-4 text-brand-700" /> Conversation health</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { l: "AI-handled", v: data.conversations.botOn, s: `of ${data.conversations.total} chats` },
                  { l: "Human-handled", v: Math.max(0, data.conversations.total - data.conversations.botOn) },
                  { l: "Escalated", v: data.conversations.escalated, s: `${r0(data.conversations.escalated, data.conversations.total)}%`, warn: true },
                  { l: "Awaiting reply", v: data.conversations.needsReply, warn: data.conversations.needsReply > 0 },
                ].map(x => (
                  <div key={x.l} className="bg-canvas rounded-control p-3">
                    <p className={`text-xl font-bold tnum ${x.warn && x.v > 0 ? "text-amber-600" : "text-ink-900"}`}>{x.v.toLocaleString()}</p>
                    <p className="text-[11px] text-ink-500 font-medium">{x.l}</p>
                    {x.s && <p className="text-[10px] text-ink-400">{x.s}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-1.5"><Send className="w-4 h-4 text-brand-700" /> Channels</p>
              {(() => {
                const wa = data.conversations.whatsapp, ig = data.conversations.instagram, tot = Math.max(1, wa + ig);
                return (
                  <div className="space-y-3">
                    {[{ l: "WhatsApp", n: wa, c: "bg-brand-600" }, { l: "Instagram", n: ig, c: "bg-pink-500" }].map(x => (
                      <div key={x.l}>
                        <div className="flex justify-between text-xs mb-1"><span className="text-ink-600">{x.l}</span><span className="tnum text-ink-900 font-semibold">{x.n.toLocaleString()} · {r0(x.n, tot)}%</span></div>
                        <div className="bg-canvas rounded-full h-2.5 overflow-hidden"><div className={`${x.c} h-full rounded-full`} style={{ width: `${Math.max(2, (x.n / tot) * 100)}%` }} /></div>
                      </div>
                    ))}
                    <p className="text-[11px] text-ink-400">{data.messaging.aiReplies14d.toLocaleString()} AI replies sent in the last 14 days.</p>
                  </div>
                );
              })()}
            </section>
          </div>

          <section className="bg-white rounded-card border border-line p-5">
            <p className="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-1.5"><Zap className="w-4 h-4 text-brand-700" /> Automation coverage</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                { l: "Chatbot flows", v: `${data.automation.flowsActive}/${data.automation.flows}`, s: "active / total" },
                { l: "Drip sequences", v: `${data.automation.sequencesActive}/${data.automation.sequences}`, s: "active / total" },
                { l: "Active drips", v: data.automation.activeEnrollments.toLocaleString(), s: "people enrolled" },
                { l: "AI replies (14d)", v: data.messaging.aiReplies14d.toLocaleString() },
              ].map(x => (
                <div key={x.l} className="bg-canvas rounded-control p-3">
                  <p className="text-xl font-bold tnum text-ink-900">{x.v}</p>
                  <p className="text-[11px] text-ink-500 font-medium">{x.l}</p>
                  {x.s && <p className="text-[10px] text-ink-400">{x.s}</p>}
                </div>
              ))}
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-1.5"><Users className="w-4 h-4 text-brand-700" /> Audience</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-canvas rounded-control p-3"><p className="text-xl font-bold tnum text-ink-900">{data.contacts.active.toLocaleString()}</p><p className="text-[11px] text-ink-500 font-medium">Active</p></div>
                <div className="bg-canvas rounded-control p-3"><p className="text-xl font-bold tnum text-brand-700">+{data.contacts.new14d.toLocaleString()}</p><p className="text-[11px] text-ink-500 font-medium">New (14d)</p></div>
                <div className="bg-canvas rounded-control p-3"><p className="text-xl font-bold tnum text-ink-900">{r0(data.contacts.optedOut, data.contacts.active + data.contacts.optedOut)}%</p><p className="text-[11px] text-ink-500 font-medium">Opt-out rate</p></div>
              </div>
            </section>

            <section className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-semibold text-ink-900 mb-3 flex items-center gap-1.5"><Send className="w-4 h-4 text-brand-700" /> Recent campaigns</p>
              {data.recentCampaigns.length === 0 ? <p className="text-xs text-ink-400">No campaigns yet.</p> : (
                <div className="divide-y divide-line">
                  {data.recentCampaigns.map((c, i) => (
                    <div key={i} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink-900 truncate">{c.name}</span>
                      <span className="text-[11px] text-ink-400 tnum shrink-0">{c.sent.toLocaleString()}/{c.total.toLocaleString()} · {c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {!data && !notice && <p className="text-center text-ink-400 text-sm py-8">Loading…</p>}
    </div>
  );
}


export default AnalyticsTab;
