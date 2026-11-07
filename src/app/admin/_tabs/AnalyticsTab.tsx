"use client";
import TrackedLinkAnalytics from "./TrackedLinkAnalytics";
import { DEFAULT_RANGE, bucketLabel, presetOptions, previousWindow, type PresetKey, type RangeKey } from "@/lib/analytics-range";

// Analytics: messages, chats, automations and audience over one chosen window.
// Lazy-loaded as its own chunk. Charts come from components/charts.tsx so every
// figure can be hovered, read with the keyboard, or shown as a table.

import { useState, useEffect } from "react";
import { useVocab } from "@/lib/vocab-client";
import { AlertTriangle, CircleCheck, Database, Loader2, MessageSquare, Send, Sparkles, TrendingUp, Users, Zap } from "lucide-react";
import { type AnalyticsData, type GoTo, EmptyState, inp } from "../_shared";
import { DataPageHeader, DateRange, ExportCsvButton, LoadStatus } from "@/components/date-range";
import { ChartCard, Delta, HBars, SERIES_COLORS, ShowAsTable, TimeChart, tableRows, type ChartPoint, type ChartSeries } from "@/components/charts";
import { csvDate, csvFileName, downloadCsv, toCsv } from "@/lib/csv-export";
import { fmtNum, fmtPct } from "@/lib/format";
import { openTab } from "@/lib/open-tab";

// The API also counts Messenger and website-chat conversations; older payloads
// (and the shared type, for now) may not carry them.
type Data = AnalyticsData & { conversations: AnalyticsData["conversations"] & { messenger?: number; webchat?: number } };

/** The windows this screen offers — all of them answerable by /api/admin/analytics. */
const RANGE_OPTIONS = presetOptions(["7d", "30d", "90d", "all"]);

type ExecBrief = { health: "strong" | "steady" | "at-risk"; headline: string; working: string[]; lacking: string[]; steps: { action: string; why: string }[] };

// ── Ask your data — a question in plain words, answered from read-only counts ──
// The model only picks among fixed counting tools (askdata-tools.ts), and every
// count it used is listed under the answer so the figure can be checked.
type AskStep = { tool: string; description: string };
const ASK_EXAMPLES = ["How many new leads came in yesterday?", "How many chats are waiting on a reply?", "Leads by source last week"];

function AskDataCard() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; steps: AskStep[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question = q) {
    if (!question.trim()) return;
    setQ(question); setBusy(true); setErr(null);
    try {
      const d = await fetch("/api/admin/ask-data", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }),
      }).then(r => r.json());
      if (d.error) { setErr(d.error); setRes(null); } else setRes(d);
    } catch { setErr("Couldn't reach Talko — check your connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-brand-700" aria-hidden /> Ask your data</h2>
        <p className="text-xs text-ink-500 mt-0.5">Ask about leads, chats, messages, broadcasts or follow-ups. Every answer shows exactly what was counted.</p>
      </div>
      <form onSubmit={e => { e.preventDefault(); void ask(); }} className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} maxLength={500} placeholder="e.g. How many leads from Instagram last week?"
          aria-label="Your question" className={`${inp} flex-1 min-w-0 text-sm`} />
        <button type="submit" disabled={busy || !q.trim()}
          className="shrink-0 min-h-9 px-3 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />} Ask
        </button>
      </form>
      {!res && !err && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {ASK_EXAMPLES.map(x => (
            <button key={x} type="button" onClick={() => void ask(x)} className="min-h-8 px-3 rounded-full border border-line text-[12px] text-ink-600 hover:bg-canvas">{x}</button>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-red-700" role="alert">{err}</p>}
      {res && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm text-ink-900">{res.answer}</p>
          {res.steps.length > 0 && (
            <div className="text-[12px] text-ink-500 border-t border-line pt-2">
              <p className="font-bold text-ink-500 mb-1">How I counted</p>
              <ul className="space-y-0.5">{res.steps.map((st, i) => <li key={i}>{st.description}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Chart points for the daily (or weekly / monthly) send series. Pure. */
export function messagePoints(data: Pick<AnalyticsData, "daily" | "range">): ChartPoint[] {
  const g = data.range.granularity;
  return data.daily.map(d => ({
    key: d.date,
    label: bucketLabel(d.date, g).replace(/^Week of /, ""),
    title: bucketLabel(d.date, g),
    values: { sent: d.sent, delivered: d.delivered, read: d.read, failed: d.failed },
  }));
}

const MESSAGE_SERIES: ChartSeries[] = [
  { key: "sent", label: "Sent", color: SERIES_COLORS.primary, mark: "area" },
  { key: "read", label: "Read", color: SERIES_COLORS.secondary, mark: "dashed" },
  { key: "delivered", label: "Delivered", mark: "none" },
  { key: "failed", label: "Failed", mark: "none" },
];

/** The four channels a chat can start on, in a fixed order. Missing counts (older data) are left out. Pure. */
export function channelSplit(c: Data["conversations"]): { label: string; value: number }[] {
  const rows: { label: string; value: number | undefined }[] = [
    { label: "WhatsApp", value: c.whatsapp },
    { label: "Instagram", value: c.instagram },
    { label: "Messenger", value: c.messenger },
    { label: "Website chat", value: c.webchat },
  ];
  return rows.filter((r): r is { label: string; value: number } => typeof r.value === "number");
}

const STATUS_WORDS: Record<string, string> = { done: "Sent", completed: "Sent", sending: "Sending", running: "Sending", scheduled: "Scheduled", draft: "Draft", failed: "Failed", paused: "Paused", cancelled: "Cancelled" };

function AnalyticsTab({ isAdmin = false, goTo }: { isAdmin?: boolean; goTo?: GoTo }) {
  const { vocab } = useVocab();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [brief, setBrief] = useState<ExecBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  useEffect(() => {
    // The previous window's figures stay on screen, dimmed, until the new ones
    // arrive — and their headings are written from data.range, so a heading and
    // its numbers can't disagree while it loads.
    let active = true;
    setLoading(true);
    fetch(`/api/admin/analytics?range=${range}`).then(r => r.json())
      .then(d => { if (!active) return; setData(d.analytics ?? null); setNotice(d.notice ?? null); setUpdatedAt(Date.now()); })
      .catch(() => { if (active) setNotice("Couldn't reach Talko — check your connection and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range]);

  async function genBrief() {
    setBriefBusy(true); setBriefErr(null);
    try {
      const d = await fetch("/api/admin/analytics/brief", { method: "POST" }).then(r => r.json());
      if (d.brief) setBrief(d.brief); else setBriefErr(d.error || "Could not write the summary.");
    } catch { setBriefErr("Couldn't reach Talko — check your connection and try again."); }
    finally { setBriefBusy(false); }
  }

  function exportCsv() {
    if (!data) return;
    const g = data.range.granularity;
    const first = g === "month" ? "Month" : g === "week" ? "Week starting" : "Date";
    const rows = data.daily.map(d => [g === "month" ? bucketLabel(d.date, "month") : csvDate(d.date), d.sent, d.delivered, d.read, d.failed]);
    downloadCsv(csvFileName(["analytics", data.range.label]), toCsv([first, "Sent", "Delivered", "Read", "Failed"], rows));
  }

  const pct = (n: number, d: number) => (d > 0 ? fmtPct(n / d) : "—");
  const r0 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const sumWeek = (rows: { sent: number; delivered: number; read: number; failed: number }[]) =>
    rows.reduce((a, x) => ({ sent: a.sent + x.sent, delivered: a.delivered + x.delivered, read: a.read + x.read, failed: a.failed + x.failed }), { sent: 0, delivered: 0, read: 0, failed: 0 });
  // Recent half vs the half before it — holds for any range length; an odd
  // bucket count drops the middle one rather than double-counting it.
  const wow = data && data.daily.length >= 2 ? (() => {
    const half = Math.floor(data.daily.length / 2);
    const prev = sumWeek(data.daily.slice(0, half)), cur = sumWeek(data.daily.slice(-half));
    const dpct = prev.sent > 0 ? Math.round(((cur.sent - prev.sent) / prev.sent) * 100) : (cur.sent > 0 ? 100 : 0);
    const g = data.range.granularity;
    const unit = g === "month" ? "months" : g === "week" ? "weeks" : "days";
    return { prev, cur, dpct, half, unit, comparison: previousWindow(half, g) };
  })() : null;
  const healthStyle = (h: string) => h === "strong" ? "bg-emerald-100 text-emerald-800" : h === "at-risk" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";

  // Secondary KPIs (the first metric is the hero card below).
  const t = data?.messaging.totals;
  const cards: { label: string; value: string; sub?: string; icon: React.ReactNode }[] = data && t ? [
    { label: "Sent today", value: fmtNum(data.messaging.sentToday), sub: `Daily limit ${fmtNum(Number(process.env.NEXT_PUBLIC_WA_DAILY_LIMIT ?? 900))}`, icon: <Send className="w-[18px] h-[18px]" /> },
    { label: "Delivered", value: pct(t.delivered, t.sent), sub: `${fmtNum(t.delivered)} messages · ${data.range.short}`, icon: <CircleCheck className="w-[18px] h-[18px]" /> },
    { label: "Read", value: pct(t.read, t.sent), sub: `${fmtNum(t.read)} messages · ${data.range.short}`, icon: <MessageSquare className="w-[18px] h-[18px]" /> },
    { label: "Broadcasts", value: fmtNum(data.campaigns.total), sub: `${fmtNum(data.campaigns.automations)} sent automatically`, icon: <Send className="w-[18px] h-[18px]" /> },
    { label: "Chats", value: fmtNum(data.conversations.total), sub: `${fmtNum(data.conversations.escalated)} handed to your team · ${fmtNum(data.conversations.needsReply)} waiting`, icon: <MessageSquare className="w-[18px] h-[18px]" /> },
    { label: `Failed to send (${data.range.short})`, value: fmtNum(t.failed), icon: <AlertTriangle className="w-[18px] h-[18px]" /> },
    { label: "Business info the AI uses", value: fmtNum(data.kb.documents), sub: `${fmtNum(data.kb.ready)} ready to use`, icon: <Database className="w-[18px] h-[18px]" /> },
  ] : [];

  const points = data ? messagePoints(data) : [];
  const channels = data ? channelSplit(data.conversations) : [];
  const channelTotal = channels.reduce((s, c) => s + c.value, 0);

  return (
    <div className="max-w-6xl space-y-5">
      <DataPageHeader
        title="Analytics"
        subtitle="Messages and chats across WhatsApp, Instagram, Messenger and your website chat."
        status={<LoadStatus loading={loading && !!data} updatedAt={updatedAt} className="mt-1" />}
        controls={<>
          {/* The window every figure below is computed over. */}
          <DateRange options={RANGE_OPTIONS} value={range as PresetKey} onChange={k => setRange(k as RangeKey)} />
          <ExportCsvButton onClick={exportCsv} disabled={!data || !data.daily.length} label="Download daily numbers (CSV)" />
        </>}
      />
      {notice && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-control px-4 py-3 text-sm text-amber-900">{notice}</div>}
      {isAdmin && <AskDataCard />}
      {/* Where chats came from — follows the range picker above. */}
      <TrackedLinkAnalytics range={range} />
      {!data && loading && <p className="flex items-center justify-center gap-2 text-ink-500 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading your numbers…</p>}
      {data && t && (
        <div aria-busy={loading} className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* ── Owner's overview: latest half of the window vs the half before + AI summary ── */}
          <section className="rounded-card border border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-brand-700" aria-hidden /> How you&apos;re doing</h2>
                <p className="text-[12px] text-ink-500">{wow ? `Latest ${wow.half} ${wow.unit} compared with the ${wow.comparison}.` : "Latest period compared with the one before."} The AI summary always reads the last 14 days.</p>
              </div>
              <button onClick={genBrief} disabled={briefBusy} className="shrink-0 min-h-9 px-3 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                {briefBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />} {brief ? "Refresh AI summary" : "Write AI summary"}
              </button>
            </div>

            {wow && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: `Messages sent, latest ${wow.half} ${wow.unit}`, value: fmtNum(wow.cur.sent), change: wow.dpct, unit: "%" as const, goodWhen: "up" as const },
                  { label: "Read", value: `${r0(wow.cur.read, wow.cur.sent)}%`, change: r0(wow.cur.read, wow.cur.sent) - r0(wow.prev.read, wow.prev.sent), unit: "points" as const, goodWhen: "up" as const },
                  { label: "Delivered", value: `${r0(wow.cur.delivered, wow.cur.sent)}%`, change: r0(wow.cur.delivered, wow.cur.sent) - r0(wow.prev.delivered, wow.prev.sent), unit: "points" as const, goodWhen: "up" as const },
                  { label: "Failed to send", value: fmtNum(wow.cur.failed), change: wow.cur.failed - wow.prev.failed, unit: "" as const, goodWhen: "down" as const },
                ].map(k => (
                  <div key={k.label} className="bg-white rounded-control border border-line p-3">
                    <p className="text-[20px] font-bold text-ink-900 tnum leading-none">{k.value}</p>
                    <p className="text-[12px] text-ink-600 font-medium mt-1">{k.label}</p>
                    <Delta change={k.change} unit={k.unit} comparison={wow.comparison} goodWhen={k.goodWhen} />
                  </div>
                ))}
              </div>
            )}

            {briefErr && <p className="text-xs text-red-700" role="alert">{briefErr}</p>}
            {!brief && !briefBusy && !briefErr && <p className="text-xs text-ink-600">Tap <b>Write AI summary</b> for a short read of your whole account — what&apos;s working, what&apos;s missing, and what to do next.</p>}
            {briefBusy && !brief && <p className="text-xs text-ink-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Reading the last 14 days…</p>}
            {brief && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${healthStyle(brief.health)}`}>{brief.health === "strong" ? "Strong" : brief.health === "at-risk" ? "Needs attention" : "Steady"}</span>
                  <p className="text-sm font-semibold text-ink-900">{brief.headline}</p>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="bg-white rounded-control border border-line p-3">
                    <p className="text-[12px] font-bold text-emerald-800 mb-1.5">What&apos;s working</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-ink-700">{brief.working.map((w, i) => <li key={i}>{w}</li>)}{!brief.working.length && <li className="list-none text-ink-500">—</li>}</ul>
                  </div>
                  <div className="bg-white rounded-control border border-line p-3">
                    <p className="text-[12px] font-bold text-red-700 mb-1.5">What&apos;s missing</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-ink-700">{brief.lacking.map((w, i) => <li key={i}>{w}</li>)}{!brief.lacking.length && <li className="list-none text-ink-500">—</li>}</ul>
                  </div>
                </div>
                {brief.steps.length > 0 && (
                  <div className="bg-white rounded-control border border-line p-3">
                    <p className="text-[12px] font-bold text-ink-600 mb-1.5">Do next, most useful first</p>
                    <ol className="space-y-2">
                      {brief.steps.map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-brand-700 text-white font-bold flex items-center justify-center text-[11px]" aria-hidden>{i + 1}</span>
                          <span><span className="font-semibold text-ink-900">{s.action}</span>{s.why ? <span className="text-ink-600"> — {s.why}</span> : null}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <p className="text-[11px] text-ink-500">Written by AI from your numbers — check before acting on it.</p>
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="relative overflow-hidden rounded-card p-5 bg-gradient-to-br from-brand-600 to-brand-900 text-white">
              <div className="w-9 h-9 rounded-control bg-white/15 flex items-center justify-center"><Users className="w-[18px] h-[18px]" aria-hidden /></div>
              <p className="text-[28px] font-bold mt-3 leading-none tnum">{fmtNum(data.contacts.active)}</p>
              <p className="text-[13px] font-medium text-white/90 mt-1.5">Active {vocab.contact.many.toLowerCase()}</p>
              <p className="text-[12px] text-white/80 mt-0.5">{fmtNum(data.contacts.optedOut)} asked to stop messages</p>
            </div>
            {cards.map(c => (
              <div key={c.label} className="bg-white rounded-card border border-line p-5 transition-colors hover:border-[#D4D4D8]">
                <div className="w-9 h-9 rounded-control bg-brand-50 text-brand-700 flex items-center justify-center" aria-hidden>{c.icon}</div>
                <p className="text-[28px] font-bold text-ink-900 mt-3 leading-none tnum tracking-[-0.02em]">{c.value}</p>
                <p className="text-[13px] font-medium text-ink-600 mt-1.5">{c.label}</p>
                {c.sub && <p className="text-[12px] text-ink-500 mt-0.5">{c.sub}</p>}
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2 min-w-0" title="Messages sent" sub={`${data.range.label} · ${fmtNum(t.sent)} in all`}
              aside={<span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-bold text-brand-800">{pct(t.delivered, t.sent)} delivered</span>}>
              <TimeChart points={points} series={MESSAGE_SERIES} label={`Messages sent and read, ${data.range.label.toLowerCase()}`} />
              <ShowAsTable caption={`Messages by ${data.range.granularity}, ${data.range.label.toLowerCase()}`}
                columns={[data.range.granularity === "month" ? "Month" : data.range.granularity === "week" ? "Week" : "Day", ...MESSAGE_SERIES.map(s => s.label)]}
                rows={tableRows(points, MESSAGE_SERIES)} />
            </ChartCard>

            <ChartCard title="What happened to your messages" sub={`${data.range.label} · share of every message we tried to send`}>
              <HBars label="Messages by result" format={fmtNum} items={[
                { label: "Read", value: t.read },
                { label: "Delivered, not read yet", value: Math.max(0, t.delivered - t.read) },
                { label: "Sent, no delivery receipt yet", value: Math.max(0, t.sent - t.delivered), tone: "muted" },
                { label: "Failed to send", value: t.failed, tone: "bad" },
              ]} />
            </ChartCard>
          </div>

          {/* ── sent → delivered → read → replied ── */}
          <ChartCard title="How far your messages got" sub={`${data.range.label} — and where people drop off.`}>
            {(() => {
              const base = Math.max(1, t.sent);
              const stages = [
                { label: "Sent", n: t.sent },
                { label: "Delivered", n: t.delivered },
                { label: "Read", n: t.read },
                { label: "Replied", n: data.messaging.repliedInRange },
              ];
              return (
                <ul className="space-y-2" aria-label="Messages at each step">
                  {stages.map((s, i) => (
                    <li key={s.label} className="flex items-center gap-3">
                      <span className="w-20 text-[13px] text-ink-700 shrink-0">{s.label}</span>
                      <div className="flex-1 bg-canvas rounded-full h-5 overflow-hidden" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (s.n / base) * 100))}%`, background: SERIES_COLORS.primary, opacity: 1 - i * 0.18 }} /></div>
                      <span className="w-28 text-right text-[13px] tnum shrink-0">{fmtNum(s.n)}{i > 0 && <span className="text-ink-500"> · {r0(s.n, base)}%</span>}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </ChartCard>

          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title={<span className="flex items-center gap-1.5"><MessageSquare className="w-4 h-4 text-brand-700" aria-hidden /> Chats right now</span>} sub="Every chat, as it stands today — not limited to the date range.">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { l: "AI is replying", v: data.conversations.botOn, s: `of ${fmtNum(data.conversations.total)} chats` },
                  { l: "A person is replying", v: Math.max(0, data.conversations.total - data.conversations.botOn) },
                  { l: "Handed to your team", v: data.conversations.escalated, s: `${r0(data.conversations.escalated, data.conversations.total)}% of chats`, warn: true },
                  { l: "Waiting for a reply", v: data.conversations.needsReply, warn: data.conversations.needsReply > 0 },
                ].map(x => (
                  <div key={x.l} className="bg-canvas rounded-control p-3">
                    <p className={`text-xl font-bold tnum ${x.warn && x.v > 0 ? "text-amber-800" : "text-ink-900"}`}>{fmtNum(x.v)}</p>
                    <p className="text-[12px] text-ink-600 font-medium">{x.l}</p>
                    {x.s && <p className="text-[12px] text-ink-500">{x.s}</p>}
                  </div>
                ))}
              </div>
            </ChartCard>

            <ChartCard title={<span className="flex items-center gap-1.5"><Send className="w-4 h-4 text-brand-700" aria-hidden /> Chats by channel</span>} sub="Where every chat so far started — not limited to the date range.">
              {channelTotal === 0 ? <p className="text-[13px] text-ink-500">No chats yet.</p> : <HBars label="Chats by channel" items={channels} format={fmtNum} />}
              <p className="mt-3 text-[12px] text-ink-500">{fmtNum(data.messaging.aiRepliesInRange)} AI replies sent · {data.range.label.toLowerCase()}.</p>
            </ChartCard>
          </div>

          <ChartCard title={<span className="flex items-center gap-1.5"><Zap className="w-4 h-4 text-brand-700" aria-hidden /> Automations</span>}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                { l: "Chatbot flows running", v: `${fmtNum(data.automation.flowsActive)} of ${fmtNum(data.automation.flows)}`, s: "switched on, of all you've made" },
                { l: "Follow-up messages running", v: `${fmtNum(data.automation.sequencesActive)} of ${fmtNum(data.automation.sequences)}`, s: "switched on, of all you've made" },
                { l: "People getting follow-ups", v: fmtNum(data.automation.activeEnrollments), s: "right now" },
                { l: "AI replies sent", v: fmtNum(data.messaging.aiRepliesInRange), s: data.range.label.toLowerCase() },
              ].map(x => (
                <div key={x.l} className="bg-canvas rounded-control p-3">
                  <p className="text-xl font-bold tnum text-ink-900">{x.v}</p>
                  <p className="text-[12px] text-ink-600 font-medium">{x.l}</p>
                  {x.s && <p className="text-[12px] text-ink-500">{x.s}</p>}
                </div>
              ))}
            </div>
          </ChartCard>

          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title={<span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-brand-700" aria-hidden /> {vocab.contact.many}</span>}>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3 text-sm">
                <div className="bg-canvas rounded-control p-3"><p className="text-xl font-bold tnum text-ink-900">{fmtNum(data.contacts.active)}</p><p className="text-[12px] text-ink-600 font-medium">Active</p></div>
                <div className="bg-canvas rounded-control p-3"><p className="text-xl font-bold tnum text-ink-900">+{fmtNum(data.contacts.newInRange)}</p><p className="text-[12px] text-ink-600 font-medium">New · {data.range.short}</p></div>
                <div className="bg-canvas rounded-control p-3"><p className="text-xl font-bold tnum text-ink-900">{r0(data.contacts.optedOut, data.contacts.active + data.contacts.optedOut)}%</p><p className="text-[12px] text-ink-600 font-medium">Asked to stop</p></div>
              </div>
            </ChartCard>

            <ChartCard title={<span className="flex items-center gap-1.5"><Send className="w-4 h-4 text-brand-700" aria-hidden /> Recent broadcasts</span>}>
              {data.recentCampaigns.length === 0 ? (
                <EmptyState title="No broadcasts yet"
                  body="A broadcast sends one message — an offer, a reminder, news — to many customers at once. Its delivery and reads show up here."
                  action={<button type="button" onClick={() => openTab("broadcast", goTo)} className="min-h-9 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-semibold">Send your first broadcast</button>} />
              ) : (
                <ul className="divide-y divide-line">
                  {data.recentCampaigns.map((c, i) => (
                    <li key={i} className="py-2 flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                      <span className="text-[13px] font-medium text-ink-900 truncate max-w-full">{c.name}</span>
                      <span className="text-[12px] text-ink-500 tnum shrink-0">{fmtNum(c.sent)} of {fmtNum(c.total)} sent · {STATUS_WORDS[c.status] ?? c.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}


export default AnalyticsTab;
