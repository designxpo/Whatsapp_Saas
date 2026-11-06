"use client";

// Today — the work waiting for a person, from every part of the product, each
// with who should do it, what to do and by when (src/lib/today.ts). Overdue
// first. Tasks can be added and ticked off here; everything else opens where
// it's handled (the chat, the review, the orders screen).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock, ListTodo, Loader2, Plus, Settings2, UserRound, X } from "lucide-react";
import { Notice, useNotice } from "@/components/Notice";
import { requestReviewFocus } from "@/lib/review-focus";
import { inp, type GoTo } from "../_shared";

type Kind = "reply" | "ready_to_pay" | "approval" | "unpaid_order" | "task" | "review_case" | "commitment";
type Item = {
  key: string; kind: Kind; title: string; detail: string; person: string | null; action: string;
  dueAt: string | null; overdue: boolean; mine: boolean; taskId?: string;
  open: { tab: "livechat"; phone: string } | { tab: "reviews"; reviewId: string } | { tab: "catalog" } | { tab: "growth" } | { tab: "today" };
};
type Settings = { replyTargetMinutes: number; alertEmails: boolean; alertHours: { start: number; end: number } | null; unpaidReminder: { enabled: boolean; afterMinutes: number } };
type Times = { days: number; answered: number; medianMinutes: number | null; p90Minutes: number | null; withinTargetPct: number | null; byPeople: { answered: number; medianMinutes: number | null }; partial: boolean };
type Data = {
  items: Item[]; settings: Settings; setupPending: boolean; responseTimes: Times | null;
  counts: { overdue: number; dueToday: number; unassigned: number; mine: number };
  team: { id: string; name: string }[]; me: { id: string | null; role: string; canManage: boolean };
};
type Filter = "all" | "mine" | "unassigned";

const KIND_LABEL: Record<Kind, string> = {
  reply: "Customer waiting", ready_to_pay: "Ready to pay", approval: "Approval", unpaid_order: "Unpaid order",
  task: "Task", review_case: "Review complaint", commitment: "Promise made",
};

function dueText(iso: string | null, overdue: boolean): string {
  if (!iso) return "No due date";
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  const span = (m: number) => m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  if (overdue) return `${span(Math.max(1, -mins))} overdue`;
  if (mins < 60) return `Due in ${span(Math.max(1, mins))}`;
  return `Due ${new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

const fmtMin = (m: number | null) => m === null ? "—" : m < 1 ? "under a minute" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`;

export default function TodayTab({ goTo }: { goTo: GoTo }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useNotice();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/today");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || "Couldn't load today's work."); return; }
      setErr(null); setD(j);
    } catch { setErr("Couldn't reach the server."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  const shown = useMemo(() => (d?.items ?? []).filter(i => filter === "all" || (filter === "mine" ? i.mine : !i.person)), [d, filter]);

  function open(i: Item) {
    if (i.open.tab === "livechat") goTo("livechat", { openPhone: i.open.phone });
    else if (i.open.tab === "reviews") { requestReviewFocus(i.open.reviewId); goTo("reviews"); }
    else if (i.open.tab === "catalog" || i.open.tab === "growth") goTo(i.open.tab);
  }

  async function finish(i: Item) {
    if (!i.taskId) return;
    setBusy(i.key);
    try {
      const r = await fetch(`/api/admin/tasks/${i.taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) setNote(j.error || "Couldn't mark it done.");
      else { setD(cur => cur && { ...cur, items: cur.items.filter(x => x.key !== i.key) }); setNote("Done.", "ok"); }
    } finally { setBusy(null); }
  }

  if (!d && !err) return <div className="flex items-center gap-2 p-6 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading today&apos;s work…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink-900">Today</h1>
          <p className="text-sm text-ink-600">Everything waiting for a person — who should do it, and by when. Overdue first.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-700 px-3 py-2 text-xs font-bold text-white hover:bg-brand-600">
            <Plus className="h-3.5 w-3.5" /> Add a task
          </button>
          {d?.me.role === "admin" && (
            <button onClick={() => setShowSettings(s => !s)} aria-expanded={showSettings} className="inline-flex items-center gap-1.5 rounded-control border border-line bg-white px-3 py-2 text-xs font-bold text-ink-700 hover:bg-canvas">
              <Settings2 className="h-3.5 w-3.5" /> Settings
            </button>
          )}
        </div>
      </header>

      {err && <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      <Notice notice={note} variant="banner" onClose={() => setNote(null)} />
      {d?.setupPending && (
        <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
          Tasks and customer owners are still being set up for your workspace. Everything else below is live.
        </div>
      )}

      {d && showSettings && <TodaySettings initial={d.settings} onSaved={s => { setD({ ...d, settings: s }); setShowSettings(false); setNote("Settings saved.", "ok"); void load(); }} onClose={() => setShowSettings(false)} />}
      {d && adding && <AddTask team={d.team} myId={d.me.id} onDone={() => { setAdding(false); setNote("Task added.", "ok"); void load(); }} onCancel={() => setAdding(false)} />}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Overdue" value={d.counts.overdue} tone={d.counts.overdue ? "bad" : "ok"} />
            <Tile label="Due later today" value={d.counts.dueToday} />
            <Tile label="Nobody assigned" value={d.counts.unassigned} tone={d.counts.unassigned ? "warn" : undefined} onClick={() => setFilter("unassigned")} />
            <Tile label="Yours" value={d.counts.mine} onClick={() => setFilter("mine")} />
          </div>

          <ResponseCard times={d.responseTimes} target={d.settings.replyTargetMinutes} />

          <div role="tablist" aria-label="Whose work" className="inline-flex rounded-control border border-line bg-white p-0.5">
            {([["all", "Everyone"], ["mine", "Mine"], ["unassigned", "Unassigned"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={`rounded-control px-3 py-1.5 text-xs font-bold ${filter === k ? "bg-brand-700 text-white" : "text-ink-600 hover:bg-canvas"}`}>{label}</button>
            ))}
          </div>

          <section className="overflow-hidden rounded-card border border-line bg-white">
            {!shown.length ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden />
                <p className="text-sm font-bold text-ink-900">{filter === "all" ? "Nothing waiting right now" : filter === "mine" ? "Nothing waiting for you" : "Everything has an owner"}</p>
                <p className="max-w-sm text-[12px] text-ink-500">Customers waiting for a reply, leads ready to pay, approvals, unpaid orders, tasks, review complaints and promises made in social chats all show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {shown.map(i => {
                  const soon = !i.overdue && i.dueAt && Date.parse(i.dueAt) - Date.now() < 60 * 60_000;
                  return (
                    <li key={i.key} className="flex items-start gap-3 px-4 py-3">
                      <span aria-hidden className={`mt-1 h-10 w-1 shrink-0 rounded-full ${i.overdue ? "bg-red-500" : soon ? "bg-amber-400" : "bg-line"}`} />
                      {i.taskId ? (
                        <button onClick={() => void finish(i)} disabled={busy === i.key} aria-label={`Mark “${i.title}” done`} className="mt-0.5 text-ink-400 hover:text-emerald-600 disabled:opacity-50">
                          {busy === i.key ? <Loader2 className="h-5 w-5 animate-spin" /> : <Circle className="h-5 w-5" />}
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                          <span className="font-bold uppercase tracking-wide text-ink-400">{KIND_LABEL[i.kind]}</span>
                          <span className={`inline-flex items-center gap-1 font-semibold ${i.overdue ? "text-red-600" : soon ? "text-amber-700" : "text-ink-500"}`}>
                            {i.overdue ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}{dueText(i.dueAt, i.overdue)}
                          </span>
                        </div>
                        <p className="truncate text-[14px] font-bold text-ink-900">{i.title}</p>
                        {i.detail && <p className="line-clamp-2 text-[12px] text-ink-600">{i.detail}</p>}
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px]">
                          <span className="font-semibold text-ink-800">{i.action}</span>
                          <span className={`inline-flex items-center gap-1 ${i.person ? "text-ink-500" : "font-semibold text-amber-700"}`}>
                            <UserRound className="h-3 w-3" aria-hidden />{i.person ?? "Nobody assigned"}{i.mine ? " (you)" : ""}
                          </span>
                        </p>
                      </div>
                      {i.open.tab !== "today" && (
                        <button onClick={() => open(i)} className="shrink-0 rounded-control border border-line px-2.5 py-1.5 text-[11px] font-bold text-ink-900 hover:bg-canvas">Open</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <p className="text-[11px] text-ink-400">
            A customer counts as waiting once the AI has had its 2 minutes (or straight away when the chat was handed to your team). Overdue means waiting longer than your {d.settings.replyTargetMinutes}-minute reply target. Updates every minute.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone, onClick }: { label: string; value: number; tone?: "bad" | "warn" | "ok"; onClick?: () => void }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "text-ink-900";
  const body = <><p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{label}</p><p className={`mt-1 text-2xl font-extrabold tabular-nums ${color}`}>{value}</p></>;
  return onClick
    ? <button onClick={onClick} className="rounded-card border border-line bg-white p-3 text-left hover:bg-canvas">{body}</button>
    : <div className="rounded-card border border-line bg-white p-3">{body}</div>;
}

function ResponseCard({ times, target }: { times: Times | null; target: number }) {
  if (!times) return null;
  if (!times.answered) return (
    <div className="rounded-card border border-line bg-white px-4 py-3 text-[12px] text-ink-500">Reply times appear here once customers have been answered in the last {times.days} days.</div>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line bg-white px-4 py-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">First reply, last {times.days} days</p>
        <p className="text-sm text-ink-800"><b className="text-ink-900">{fmtMin(times.medianMinutes)}</b> typical · 9 in 10 within <b className="text-ink-900">{fmtMin(times.p90Minutes)}</b></p>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Within your {target}-min target</p>
        <p className={`text-sm font-bold ${(times.withinTargetPct ?? 0) >= 90 ? "text-emerald-700" : (times.withinTargetPct ?? 0) >= 70 ? "text-amber-700" : "text-red-600"}`}>{times.withinTargetPct}% of {times.answered} replies</p>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">When a person replied</p>
        <p className="text-sm text-ink-800">{times.byPeople.answered ? <><b className="text-ink-900">{fmtMin(times.byPeople.medianMinutes)}</b> typical ({times.byPeople.answered})</> : "No replies from people yet"}</p>
      </div>
      {times.partial && <p className="w-full text-[11px] text-ink-400">Based on the most recent 20,000 messages.</p>}
    </div>
  );
}

function AddTask({ team, myId, onDone, onCancel }: { team: { id: string; name: string }[]; myId: string | null; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(myId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueAt: due ? new Date(due).toISOString() : null, assigneeId: assignee || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) setError(j.error || "Couldn't add the task."); else onDone();
    } finally { setSaving(false); }
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-card border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900"><ListTodo className="h-4 w-4" /> New task</p>
        <button type="button" onClick={onCancel} aria-label="Close" className="text-ink-400 hover:text-ink-900"><X className="h-4 w-4" /></button>
      </div>
      <label className="block text-[12px] font-semibold text-ink-700">What needs doing
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={300} required autoFocus placeholder="Call back about the bulk order" className={`${inp} mt-1 w-full`} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] font-semibold text-ink-700">Due
          <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} className={`${inp} mt-1 w-full`} />
        </label>
        <label className="block text-[12px] font-semibold text-ink-700">Who does it
          <select value={assignee} onChange={e => setAssignee(e.target.value)} className={`${inp} mt-1 w-full`}>
            <option value="">Nobody yet</option>
            {team.map(t => <option key={t.id} value={t.id}>{t.name}{t.id === myId ? " (you)" : ""}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-ink-500">To tie a task to a customer, add it from their chat in Live Chat.</p>
      {error && <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-ink-600">Cancel</button>
        <button disabled={saving || !title.trim()} className="rounded-control bg-brand-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-50">{saving ? "Adding…" : "Add task"}</button>
      </div>
    </form>
  );
}

function TodaySettings({ initial, onSaved, onClose }: { initial: Settings; onSaved: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hours = Array.from({ length: 25 }, (_, h) => h);
  const hourLabel = (h: number) => h === 24 ? "midnight" : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
  async function save() {
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/today/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) setError(j.error || "Couldn't save."); else onSaved(j.settings);
    } finally { setSaving(false); }
  }
  return (
    <section className="space-y-4 rounded-card border border-line bg-white p-4" aria-label="Today settings">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-ink-900">Settings</p>
        <button onClick={onClose} aria-label="Close settings" className="text-ink-400 hover:text-ink-900"><X className="h-4 w-4" /></button>
      </div>
      <label className="block text-[12px] font-semibold text-ink-700">Reply target
        <span className="mt-1 flex items-center gap-2">
          <input type="number" min={1} max={1440} value={s.replyTargetMinutes} onChange={e => setS({ ...s, replyTargetMinutes: Number(e.target.value) })} className={`${inp} w-24`} />
          <span className="font-normal text-ink-600">minutes — a customer waiting longer than this for a person shows as overdue.</span>
        </span>
      </label>
      <div className="space-y-2 rounded-control bg-canvas p-3">
        <label className="flex items-start gap-2 text-[13px] text-ink-800">
          <input type="checkbox" checked={s.alertEmails} onChange={e => setS({ ...s, alertEmails: e.target.checked })} className="mt-0.5" />
          <span><b>Email reminders</b> when a customer is waiting past the target or a task is due. Sent to the teammate it&apos;s assigned to; if nobody is, to your admins and the team lead for that number.</span>
        </label>
        {s.alertEmails && (
          <p className="flex flex-wrap items-center gap-2 pl-6 text-[12px] text-ink-700">Only between
            <select value={s.alertHours?.start ?? 9} onChange={e => setS({ ...s, alertHours: { start: Number(e.target.value), end: s.alertHours?.end ?? 20 } })} className={`${inp} py-1`}>{hours.slice(0, 24).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
            and
            <select value={s.alertHours?.end ?? 20} onChange={e => setS({ ...s, alertHours: { start: s.alertHours?.start ?? 9, end: Number(e.target.value) } })} className={`${inp} py-1`}>{hours.slice(1).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
           . Anything outside these hours is sent when they start.
          </p>
        )}
      </div>
      <div className="space-y-2 rounded-control bg-canvas p-3">
        <label className="flex items-start gap-2 text-[13px] text-ink-800">
          <input type="checkbox" checked={s.unpaidReminder.enabled} onChange={e => setS({ ...s, unpaidReminder: { ...s.unpaidReminder, enabled: e.target.checked } })} className="mt-0.5" />
          <span><b>Remind customers about unpaid orders</b> — one WhatsApp message with their payment link. Only inside WhatsApp&apos;s 24-hour window, never to anyone who opted out.</span>
        </label>
        {s.unpaidReminder.enabled && (
          <p className="flex items-center gap-2 pl-6 text-[12px] text-ink-700">Send it
            <select value={s.unpaidReminder.afterMinutes} onChange={e => setS({ ...s, unpaidReminder: { ...s.unpaidReminder, afterMinutes: Number(e.target.value) } })} className={`${inp} py-1`}>
              {[15, 30, 60, 120, 240, 480].map(m => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}</option>)}
            </select>
            after the order if it&apos;s still unpaid.
          </p>
        )}
      </div>
      {error && <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-ink-600">Cancel</button>
        <button onClick={() => void save()} disabled={saving} className="rounded-control bg-brand-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}
