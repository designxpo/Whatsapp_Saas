"use client";

// Home: a glance, then one clear next step.
//
// Top to bottom: a greeting and "What needs you" (chats waiting for a person,
// overdue work, the next few things in Today and ONE primary button for the
// most urgent of them); setup progress while setup is unfinished; the week's
// key numbers against the week before; who to call first; the how-to guide
// while it's still useful; and the rail — AI answer check (admins), delivery,
// audience and quick actions — beside it on a wide screen, below it otherwise.
//
// Every number here is the shell's own: "Waiting for you" is the same count as
// the Live Chat badge (useInboxAlerts), "Overdue" the same as the Today badge
// (useTodaySummary). Nothing on this page counts the same thing differently.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Clock, Database, EyeOff, FlaskConical, Minus, RefreshCw, Send, UserRound, Users } from "lucide-react";
import { Mascot, type Mood } from "@/components/Mascot";
import { fmtNum, fmtUpdated } from "@/lib/format";
import { requestReviewFocus } from "@/lib/review-focus";
import { useVocab } from "@/lib/vocab-client";
import { HotLeads } from "../_tabs/HotLeads";
import { type Tab, type GoTo, type AnalyticsData, RailCard, StatRow, RailBar, btnPrimary } from "../_shared";
import {
  chooseNextAction, dueWords, greetingFor, guideHiddenKey, setupProgress, weekNumbers,
  type SetupStepLike, type TodayItemLike, type WaitingLike, type TrendDir,
} from "./shell-logic";
import { useNow, type TodaySummary } from "./shell-hooks";

export interface HomeProps {
  goTo: GoTo;
  me: { name: string; email: string; role: string; tenantId?: string } | null;
  /** Chats waiting for a person (useInboxAlerts). */
  waiting: { count: number; chats: WaitingLike[]; loaded: boolean };
  /** /api/admin/today, shared with the header's Today badge. */
  today: { data: TodaySummary | null; error: string | null; updatedAt: number | null; refresh: () => void };
  canOpenTab: (t: Tab) => boolean;
}

const card = "bg-white rounded-card border border-line";
const skeleton = "rounded-control bg-slate-100 animate-pulse";

// ── Data: setup progress and the week's numbers ──────────────────────────────

/** The plan-aware setup checklist the Setup Guide uses (admins only — the route is admin-guarded). */
function useSetupSteps(enabled: boolean, tenantId: string) {
  const cacheKey = `talko.setup-complete:${tenantId}`;
  const [steps, setSteps] = useState<SetupStepLike[] | null>(null);
  const [error, setError] = useState(false);
  // Remembered from last time, so an account that is already set up doesn't
  // flash a placeholder for a card it will never show.
  const [knownComplete, setKnownComplete] = useState(false);
  useEffect(() => { try { setKnownComplete(localStorage.getItem(cacheKey) === "1"); } catch { /* no memory */ } }, [cacheKey]);
  const load = useCallback(() => {
    if (!enabled) return;
    setError(false);
    fetch("/api/admin/setup/status").then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        const list: SetupStepLike[] = Array.isArray(d.steps) ? d.steps : [];
        setSteps(list);
        const complete = setupProgress(list).complete;
        try { localStorage.setItem(cacheKey, complete ? "1" : "0"); } catch { /* fine */ }
        setKnownComplete(complete);
      })
      .catch(() => setError(true));
  }, [enabled, cacheKey]);
  useEffect(() => { load(); }, [load]);
  return { steps, error, knownComplete, reload: load };
}

type Pick7 = Pick<AnalyticsData, "contacts" | "messaging">;
function useWeek() {
  const [a7, setA7] = useState<Pick7 | null>(null);
  const [a14, setA14] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const load = useCallback(() => {
    setError(false);
    Promise.all(["7d", "14d"].map(r => fetch(`/api/admin/analytics?range=${r}`).then(res => res.json())))
      .then(([r7, r14]) => {
        if (!r7?.analytics || !r14?.analytics) throw new Error("no analytics");
        setA7(r7.analytics); setA14(r14.analytics); setUpdatedAt(Date.now());
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  return { a7, a14, error, updatedAt, reload: load };
}

// ── The page ─────────────────────────────────────────────────────────────────

export function HomeTab({ goTo, me, waiting, today, canOpenTab }: HomeProps) {
  const { vocab } = useVocab();
  const now = useNow(30_000);
  const isAdmin = me?.role === "admin";
  const tenantId = me?.tenantId ?? "default";
  const setup = useSetupSteps(isAdmin, tenantId);
  const week = useWeek();
  const progress = setupProgress(setup.steps);
  const setupIncomplete = isAdmin && !!setup.steps && progress.total > 0 && !progress.complete;

  // The how-to guide: only while setup is unfinished, and only until hidden.
  const guideKey = me ? guideHiddenKey(tenantId, me.email) : null;
  const [guideHidden, setGuideHidden] = useState(false);
  useEffect(() => { if (!guideKey) return; try { setGuideHidden(localStorage.getItem(guideKey) === "1"); } catch { /* shown */ } }, [guideKey]);
  const hideGuide = () => { setGuideHidden(true); try { if (guideKey) localStorage.setItem(guideKey, "1"); } catch { /* this visit only */ } };

  const items = today.data?.items ?? [];
  const next = useMemo(() => chooseNextAction({ waiting: waiting.chats, today: items, setupNext: setupIncomplete ? progress.next : null, now }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waiting.chats, items, setupIncomplete, progress.next, Math.floor(now / 60_000)]);

  const openItem = (i: TodayItemLike) => {
    if (i.open.tab === "livechat" && i.open.phone) goTo("livechat", { openPhone: i.open.phone });
    else if (i.open.tab === "reviews") { if (i.open.reviewId) requestReviewFocus(i.open.reviewId); goTo("reviews"); }
    else goTo(i.open.tab as Tab);
  };
  const runNext = () => {
    if (!next) return;
    if (next.kind === "reply") goTo("livechat", { openPhone: next.chat.phone });
    else if (next.kind === "today") openItem(next.item);
    else goTo((next.step.fixTab as Tab) || "setup");
  };

  const loading = !waiting.loaded || (!today.data && !today.error);
  const mood: Mood = today.error || week.error ? "oops" : loading ? "thinking" : next ? "idle" : "happy";
  const firstName = (me?.name || "").trim().split(/\s+/)[0];
  const refreshAll = () => { today.refresh(); week.reload(); setup.reload(); };

  return (
    <div className="flex flex-col xl:flex-row gap-5 xl:gap-6 items-stretch xl:items-start">
      <div className="flex-1 min-w-0 w-full max-w-4xl space-y-5">
        {/* Greeting */}
        <div className="flex items-center gap-3">
          <Mascot size={44} mood={mood} className="hidden sm:block shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-extrabold text-ink-900 truncate">{greetingFor(new Date(now).getHours())}{firstName ? `, ${firstName}` : ""}</h1>
            <p className="text-[13px] text-ink-500">{new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</p>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <span className="hidden sm:inline text-[12px] text-ink-500" aria-live="polite">{fmtUpdated(today.updatedAt ?? week.updatedAt, now)}</span>
            <button type="button" onClick={refreshAll} aria-label="Refresh Home" data-help="Check for new chats and work now (Home also refreshes every minute)."
              className="w-10 h-10 inline-flex items-center justify-center rounded-full border border-line bg-white text-ink-600 hover:bg-canvas">
              <RefreshCw className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>

        <NeedsYou
          loading={loading} waiting={waiting} today={today} items={items} next={next} now={now}
          onNext={runNext} openItem={openItem} goTo={goTo} canOpenTab={canOpenTab}
        />

        {/* Setup progress — only while required setup is unfinished. */}
        {isAdmin && !setup.steps && !setup.error && !setup.knownComplete && <div className={`${skeleton} h-[104px]`} aria-hidden />}
        {isAdmin && setup.error && !setup.knownComplete && (
          <ErrorLine text="Couldn't check your setup progress." onRetry={setup.reload} />
        )}
        {setupIncomplete && (
          <section aria-labelledby="home-setup" className={`${card} p-4 sm:p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="home-setup" className="text-[15px] font-bold text-ink-900">{progress.done} of {progress.total} setup steps done</h2>
                <p className="text-[13px] text-ink-500">Finish these and customers can message you while the AI replies.</p>
              </div>
              <button type="button" onClick={() => goTo("setup")} className="text-[13px] font-bold text-brand-700 hover:underline min-h-10 lg:min-h-8">See all steps</button>
            </div>
            <div className="mt-3 h-2 rounded-full bg-canvas overflow-hidden" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-valuetext={`${progress.done} of ${progress.total} steps done`}>
              <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            {progress.next && (
              <button type="button" onClick={() => goTo((progress.next!.fixTab as Tab) || "setup")} className={`${btnPrimary} mt-4 min-h-11 lg:min-h-9 w-full sm:w-auto justify-center`}>
                Next: {progress.next.title} <ArrowRight className="w-4 h-4" aria-hidden />
              </button>
            )}
          </section>
        )}

        <KeyNumbers week={week} contactsLabel={vocab.contact.many} goTo={goTo} canOpenTab={canOpenTab} />

        {/* Who to call first — ranked from the last three days' chats */}
        <HotLeads goTo={goTo} />

        {setupIncomplete && !guideHidden && <HowTo goTo={goTo} onHide={hideGuide} contactsLabel={vocab.contact.many} canOpenTab={canOpenTab} />}
      </div>
      <HomeRail goTo={goTo} a14={week.a14} error={week.error} onRetry={week.reload} isAdmin={isAdmin} canOpenTab={canOpenTab} />
    </div>
  );
}

// ── What needs you ───────────────────────────────────────────────────────────

function NeedsYou({ loading, waiting, today, items, next, now, onNext, openItem, goTo, canOpenTab }: {
  loading: boolean; waiting: HomeProps["waiting"]; today: HomeProps["today"]; items: TodayItemLike[];
  next: ReturnType<typeof chooseNextAction>; now: number; onNext: () => void; openItem: (i: TodayItemLike) => void;
  goTo: GoTo; canOpenTab: (t: Tab) => boolean;
}) {
  const overdue = today.data?.counts.overdue ?? 0;
  // The top three, minus whatever the big button already points at.
  const nextPhone = next?.kind === "reply" ? next.chat.phone : next?.kind === "today" ? next.item.open.phone : undefined;
  const nextKey = next?.kind === "today" ? next.item.key : undefined;
  const top = items.filter(i => i.key !== nextKey && !(nextPhone && i.open.phone === nextPhone)).slice(0, 3);

  return (
    <section aria-labelledby="home-needs" className={`${card} p-4 sm:p-5 space-y-4`}>
      <h2 id="home-needs" className="text-[15px] font-bold text-ink-900">What needs you</h2>

      {loading ? (
        <div aria-hidden className="space-y-3">
          <div className={`${skeleton} h-12`} />
          <div className="grid grid-cols-2 gap-3"><div className={`${skeleton} h-[72px]`} /><div className={`${skeleton} h-[72px]`} /></div>
          <div className={`${skeleton} h-14`} />
          <span className="sr-only">Loading</span>
        </div>
      ) : (
        <>
          {next ? (
            <button type="button" onClick={onNext}
              className={`w-full min-h-12 lg:min-h-10 px-4 py-3 lg:py-2 rounded-control text-left text-white font-semibold text-[14px] sm:text-[15px] lg:text-[14px] flex items-center gap-3 transition active:scale-[0.99] ${next.urgent ? "bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800" : "bg-ink-900 hover:bg-ink-800"}`}>
              <span className="min-w-0 flex-1">{next.label}</span>
              <ArrowRight className="w-5 h-5 shrink-0" aria-hidden />
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-control bg-emerald-50 border border-emerald-200 px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 self-start mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] sm:basis-0">
                <p className="text-[14px] font-bold text-ink-900">You&apos;re all caught up</p>
                <p className="text-[13px] text-ink-600">No customer is waiting for a person and nothing is overdue. The AI is answering new chats.</p>
              </div>
              {canOpenTab("livechat") && (
                <button type="button" onClick={() => goTo("livechat")} className="ml-8 sm:ml-0 min-h-10 lg:min-h-8 px-3 rounded-control border border-line bg-white text-[13px] font-bold text-ink-800 hover:bg-canvas">Open the inbox</button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <CountTile label="Waiting for you" value={waiting.count} words={waiting.count === 1 ? "chat needs a person" : "chats need a person"}
              onClick={() => goTo("livechat", { filter: "waiting" })} help="Chats waiting for a person to reply. Opens the inbox showing just those." />
            <CountTile label="Overdue" value={today.error ? null : overdue} words={overdue === 1 ? "item past its due time" : "items past their due time"}
              onClick={() => goTo("today")} help="Things in Today that are past their due time. Opens Today." />
          </div>

          {today.error ? (
            <ErrorLine text="Couldn't load today's work." onRetry={today.refresh} />
          ) : top.length > 0 && (
            <ul className="divide-y divide-line border-t border-line -mx-4 sm:-mx-5">
              {top.map(i => (
                <li key={i.key} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3">
                  <span aria-hidden className={`self-stretch w-1 shrink-0 rounded-full ${i.overdue ? "bg-red-500" : "bg-line"}`} />
                  <div className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] sm:basis-auto">
                    <p className="text-[14px] font-semibold text-ink-900 truncate">{i.title}</p>
                    <p className="text-[12px] text-ink-600 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className={`inline-flex items-center gap-1 ${i.overdue ? "font-semibold text-red-700" : ""}`}>
                        {i.overdue ? <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> : <Clock className="w-3.5 h-3.5" aria-hidden />}
                        {dueWords(i.dueAt, i.overdue, now)}
                      </span>
                      <span className="inline-flex items-center gap-1"><UserRound className="w-3.5 h-3.5" aria-hidden />{i.person ?? "Nobody assigned"}{i.mine ? " (you)" : ""}</span>
                    </p>
                  </div>
                  <button type="button" onClick={() => openItem(i)} aria-label={`${i.action}: ${i.title}`}
                    className="ml-4 sm:ml-0 shrink-0 min-h-10 lg:min-h-8 px-3 rounded-control border border-line text-[13px] font-bold text-ink-900 hover:bg-canvas whitespace-nowrap">{i.action}</button>
                </li>
              ))}
            </ul>
          )}

          {!today.error && canOpenTab("today") && (
            <button type="button" onClick={() => goTo("today")} className="min-h-10 lg:min-h-8 inline-flex items-center gap-1 text-[13px] font-bold text-brand-700 hover:underline">
              {items.length > top.length + (next?.kind === "today" ? 1 : 0) ? `See all ${items.length} in Today` : "Open Today"} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CountTile({ label, value, words, onClick, help }: { label: string; value: number | null; words: string; onClick: () => void; help: string }) {
  const hot = (value ?? 0) > 0;
  return (
    <button type="button" onClick={onClick} data-help={help}
      className={`text-left rounded-control border px-3 py-2.5 min-h-[72px] hover:border-brand-500 ${hot ? "border-red-200 bg-red-50/60" : "border-line bg-white"}`}>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-600">
        {hot && <AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-hidden />}{label}
      </span>
      <span className={`block text-2xl font-extrabold tabular-nums ${hot ? "text-red-700" : "text-ink-900"}`}>{value === null ? "—" : fmtNum(value)}</span>
      <span className="sr-only">{words}</span>
    </button>
  );
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-control border border-red-200 bg-red-50 px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" aria-hidden />
      <p className="flex-1 min-w-0 text-[13px] text-red-800">{text} Check your connection and try again.</p>
      <button type="button" onClick={onRetry} className="min-h-10 lg:min-h-8 px-3 rounded-control border border-red-200 bg-white text-[13px] font-bold text-red-800 hover:bg-red-50">Retry</button>
    </div>
  );
}

// ── Key numbers ──────────────────────────────────────────────────────────────

const TREND_ICON: Record<TrendDir, React.ReactNode> = {
  up: <ArrowUp className="w-3.5 h-3.5 shrink-0" aria-hidden />,
  down: <ArrowDown className="w-3.5 h-3.5 shrink-0" aria-hidden />,
  new: <ArrowUp className="w-3.5 h-3.5 shrink-0" aria-hidden />,
  same: <Minus className="w-3.5 h-3.5 shrink-0" aria-hidden />,
  none: <Minus className="w-3.5 h-3.5 shrink-0" aria-hidden />,
};

function KeyNumbers({ week, contactsLabel, goTo, canOpenTab }: { week: ReturnType<typeof useWeek>; contactsLabel: string; goTo: GoTo; canOpenTab: (t: Tab) => boolean }) {
  const rows = week.a7 && week.a14 ? weekNumbers(week.a7, week.a14, contactsLabel) : null;
  return (
    <section aria-labelledby="home-week" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-week" className="text-[15px] font-bold text-ink-900">Last 7 days</h2>
        {canOpenTab("analytics") && (
          <button type="button" onClick={() => goTo("analytics")} className="min-h-10 lg:min-h-8 inline-flex items-center gap-1 text-[13px] font-bold text-brand-700 hover:underline">
            Analytics <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
      </div>
      {week.error && !rows ? (
        <ErrorLine text="Couldn't load your numbers." onRetry={week.reload} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {rows ? rows.map(r => (
            <div key={r.key} className={`${card} p-3 sm:p-4`}>
              <p className="text-[12px] font-semibold text-ink-600">{r.label}</p>
              <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{fmtNum(r.current)}</p>
              <p className="mt-0.5 flex items-start gap-1 text-[12px] text-ink-600">{TREND_ICON[r.trend.dir]}<span>{r.trend.words}</span></p>
            </div>
          )) : [0, 1, 2, 3].map(i => <div key={i} aria-hidden className={`${skeleton} h-[104px]`} />)}
        </div>
      )}
    </section>
  );
}

// ── How to use (only while setup is unfinished) ──────────────────────────────

function HowTo({ goTo, onHide, contactsLabel, canOpenTab }: { goTo: GoTo; onHide: () => void; contactsLabel: string; canOpenTab: (t: Tab) => boolean }) {
  const many = contactsLabel.toLowerCase();
  const guide: { icon: React.ReactNode; title: string; text: string; cta: string; tab: Tab }[] = [
    { icon: <Database className="w-5 h-5" aria-hidden />, title: "1 · Teach the AI", text: "Upload your business documents (PDF, text or a website link) so the AI can answer customer questions.", cta: "Add knowledge", tab: "assistant" },
    { icon: <FlaskConical className="w-5 h-5" aria-hidden />, title: "2 · Test it", text: "Ask the AI questions in the test box — no WhatsApp needed — and check its answers.", cta: "Test the AI", tab: "assistant" },
    { icon: <Users className="w-5 h-5" aria-hidden />, title: `3 · Add ${many}`, text: `Import a spreadsheet or add ${many} with tags (for example city or interest) so you can message the right people.`, cta: `Import ${many}`, tab: "contacts" },
    { icon: <Send className="w-5 h-5" aria-hidden />, title: "4 · Send a broadcast", text: "Pick an approved message, choose who gets it, and send. Replies land in Live Chat, where the AI answers.", cta: "Send a broadcast", tab: "broadcast" },
  ];
  const steps = guide.filter(g => canOpenTab(g.tab));
  if (!steps.length) return null;
  return (
    <section aria-labelledby="home-howto">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="home-howto" className="text-[15px] font-bold text-ink-900">How to use this platform</h2>
        <button type="button" onClick={onHide} className="min-h-10 lg:min-h-8 inline-flex items-center gap-1.5 px-2 text-[13px] font-semibold text-ink-600 hover:text-ink-900">
          <EyeOff className="w-4 h-4" aria-hidden /> Hide this guide
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {steps.map(g => (
          <div key={g.title} className={`${card} p-4 flex flex-col`}>
            <div className="flex items-center gap-2 text-brand-700 mb-1.5">{g.icon}<h3 className="font-bold text-sm">{g.title}</h3></div>
            <p className="text-[13px] text-ink-600 flex-1">{g.text}</p>
            <button type="button" onClick={() => goTo(g.tab)} className="mt-2 self-start min-h-10 lg:min-h-8 text-[13px] font-bold text-brand-700 flex items-center gap-1 hover:gap-2 transition-all">{g.cta} <ArrowRight className="w-3.5 h-3.5" aria-hidden /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── The rail: beside the page on a wide screen, under it otherwise ───────────

type GroundingData = {
  stats: { deferred: number; flagged: number; audited: number };
  flagged: { id: string; question: string; unsupportedClaims: unknown; phone: string | null }[];
};

/** "AI answer check" — how often the AI held back, and answers worth a second look. Admins only. */
function AiCheckRail({ goTo, canOpenTab }: { goTo: GoTo; canOpenTab: (t: Tab) => boolean }) {
  const [g, setG] = useState<GroundingData | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    fetch("/api/admin/grounding").then(r => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then(d => { if (!d?.stats) throw new Error("bad"); setG(d); })
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  const claims = (c: unknown): string[] => Array.isArray(c) ? c.filter(x => typeof x === "string") : [];
  return (
    <RailCard title="AI answer check" action={canOpenTab("assistant") ? "Add knowledge" : undefined} onAction={() => goTo("assistant")}>
      <p className="text-[12px] text-ink-500 -mt-1">Last 7 days</p>
      {error ? (
        <div className="flex items-center justify-between gap-2"><p className="text-[12px] text-ink-600">Couldn&apos;t load this.</p><button type="button" onClick={load} className="min-h-8 px-2 text-[12px] font-bold text-brand-700">Retry</button></div>
      ) : !g ? <div aria-hidden className={`${skeleton} h-14`} /> : <>
        <StatRow label="Questions the AI couldn't answer" value={fmtNum(g.stats.deferred)} tone={g.stats.deferred > 0 ? "warn" : undefined} />
        <StatRow label="Answers to double-check" value={fmtNum(g.stats.flagged)} tone={g.stats.flagged > 0 ? "bad" : undefined} />
        {g.stats.deferred === 0 && g.stats.flagged === 0 && (
          <p className="text-[12px] text-ink-500 pt-1">Nothing to check. If the AI can&apos;t answer something, or an answer looks wrong, it shows up here.</p>
        )}
        {g.stats.deferred > 0 && g.flagged.length === 0 && (
          <p className="text-[12px] text-ink-500 pt-1">When the AI isn&apos;t sure, it asks a person instead of guessing. Adding knowledge closes those gaps.</p>
        )}
        {g.flagged.length > 0 && (
          <ul className="pt-1.5 mt-1 border-t border-line space-y-0.5">
            {g.flagged.slice(0, 4).map(f => (
              <li key={f.id}>
                <button type="button" onClick={() => goTo("livechat", f.phone ? { openPhone: f.phone } : undefined)} className="block w-full min-h-10 lg:min-h-8 text-left rounded-md px-1.5 py-1 hover:bg-canvas">
                  <span className="block text-[12px] font-semibold text-ink-800 truncate">{f.question || "An AI answer"}</span>
                  {claims(f.unsupportedClaims).length > 0 && (
                    <span className="block text-[12px] text-red-700 truncate"><AlertTriangle className="inline w-3 h-3 mr-0.5 align-[-1px]" aria-hidden />{claims(f.unsupportedClaims)[0]}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </>}
    </RailCard>
  );
}

function HomeRail({ goTo, a14, error, onRetry, isAdmin, canOpenTab }: {
  goTo: GoTo; a14: AnalyticsData | null; error: boolean; onRetry: () => void; isAdmin: boolean; canOpenTab: (t: Tab) => boolean;
}) {
  const { vocab } = useVocab();
  const t = a14?.messaging.totals;
  const pct = (n: number) => (t && t.sent ? Math.round((n / t.sent) * 100) : 0);
  const loadingLine = <div aria-hidden className={`${skeleton} h-16`} />;
  const failed = <div className="flex items-center justify-between gap-2"><p className="text-[12px] text-ink-600">Couldn&apos;t load this.</p><button type="button" onClick={onRetry} className="min-h-8 px-2 text-[12px] font-bold text-brand-700">Retry</button></div>;
  const quick = ([["New broadcast", "broadcast"], ["Templates", "templates"], ["Chatbot Flows", "flows"], [`Import ${vocab.contact.many.toLowerCase()}`, "contacts"], ["WhatsApp Forms", "forms"], ["AI Hub", "aihub"]] as [string, Tab][])
    .filter(([, tab]) => canOpenTab(tab));
  return (
    <aside aria-label="More about your workspace" className="w-full xl:w-80 shrink-0 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
      {isAdmin && <AiCheckRail goTo={goTo} canOpenTab={canOpenTab} />}
      <RailCard title="Delivery · last 14 days" action={canOpenTab("analytics") ? "Analytics" : undefined} onAction={() => goTo("analytics")}>
        {!t ? (error ? failed : loadingLine) : t.sent === 0
          ? <p className="text-[12px] text-ink-500">No messages sent yet. This fills in after your first broadcast.</p>
          : <div className="space-y-2">
              <RailBar label="Sent" count={t.sent} pct={100} color="bg-ink-900" />
              <RailBar label="Delivered" count={t.delivered} pct={pct(t.delivered)} color="bg-brand-500" />
              <RailBar label="Read" count={t.read} pct={pct(t.read)} color="bg-brand-700" />
              <RailBar label="Failed" count={t.failed} pct={pct(t.failed)} color="bg-red-500" />
            </div>}
      </RailCard>
      <RailCard title="Your audience" action={vocab.contact.many} onAction={() => goTo("contacts")}>
        {!a14 ? (error ? failed : loadingLine) : <>
          <StatRow label={`Active ${vocab.contact.many.toLowerCase()}`} value={fmtNum(a14.contacts.active)} onClick={() => goTo("contacts")} />
          <StatRow label="Asked not to be messaged" value={fmtNum(a14.contacts.optedOut)} onClick={() => goTo("optouts")} />
          <StatRow label="Sent today" value={fmtNum(a14.messaging.sentToday)} />
        </>}
      </RailCard>
      {quick.length > 0 && (
        <RailCard title="Quick actions">
          <div className="grid grid-cols-2 gap-1.5">
            {quick.map(([label, tab]) => (
              <button type="button" key={tab + label} onClick={() => goTo(tab)} className="min-h-10 lg:min-h-8 px-2.5 py-2 rounded-control border border-line text-[12px] font-bold text-ink-700 hover:border-brand-500 hover:text-brand-700 text-left">{label}</button>
            ))}
          </div>
        </RailCard>
      )}
    </aside>
  );
}

