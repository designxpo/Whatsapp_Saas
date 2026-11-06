"use client";

// Who looks after this customer, and what's next for them — in Live Chat's side
// panel. The "next action" is the customer's earliest open task (tasks.ts), so
// it always has a person and, ideally, a due date. Tasks added here show up in
// Today for whoever they're given to.

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Circle, ListTodo, Loader2, Plus, UserRound } from "lucide-react";

type Task = { id: string; title: string; dueAt: string | null; assigneeId: string | null; assigneeName: string | null };
type Data = {
  contact: { id: string; name: string; phone: string; ownerId: string | null } | null;
  tasks: Task[]; team: { id: string; name: string }[]; myId: string | null; canManage: boolean; setupPending: boolean;
};

function due(iso: string | null): { text: string; late: boolean } {
  if (!iso) return { text: "No due date", late: false };
  const t = Date.parse(iso);
  const late = t <= Date.now();
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  const text = sameDay ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { text: late ? `Overdue · ${text}` : `Due ${text}`, late };
}

export function CustomerWork({ phone, conversationId }: { phone: string; conversationId: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [who, setWho] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/customer-work?phone=${encodeURIComponent(phone)}&conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setD(j); setErr(null); setWho(w => w || j.myId || "");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [phone, conversationId]);
  useEffect(() => { setD(null); setAdding(false); setTitle(""); setWhen(""); void load(); }, [load]);

  async function setOwner(ownerId: string) {
    if (!d?.contact) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/customer-work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: d.contact.id, ownerId: ownerId || null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || "Couldn't change the owner."); else setD({ ...d, contact: { ...d.contact, ownerId: ownerId || null } });
    setBusy(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      title, dueAt: when ? new Date(when).toISOString() : null, assigneeId: who || null,
      contactId: d?.contact?.id ?? null, conversationId,
    }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || "Couldn't add the task.");
    else { setTitle(""); setWhen(""); setAdding(false); await load(); }
    setBusy(false);
  }

  async function done(t: Task) {
    setBusy(true);
    const r = await fetch(`/api/admin/tasks/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
    if (r.ok) setD(cur => cur && { ...cur, tasks: cur.tasks.filter(x => x.id !== t.id) });
    else setErr((await r.json().catch(() => ({}))).error || "Couldn't mark it done.");
    setBusy(false);
  }

  const field = "w-full border border-line rounded-control px-2.5 py-1.5 text-xs focus:outline-none bg-white";
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5" /> Looks after this customer</p>
        {d === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : d.contact ? (
          d.canManage ? (
            <select disabled={busy || d.setupPending} value={d.contact.ownerId ?? ""} onChange={e => void setOwner(e.target.value)} className={field} aria-label="Who looks after this customer">
              <option value="">Nobody yet</option>
              {d.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : <p className="text-xs text-ink-700">{d.team.find(t => t.id === d.contact?.ownerId)?.name ?? "Nobody yet"}</p>
        ) : <p className="text-[11px] text-ink-400">Not saved as a contact yet, so there&apos;s no owner. Tasks below still work.</p>}
      </div>

      <div>
        <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><ListTodo className="w-3.5 h-3.5" /> Next steps</p>
        {d && (
          <ul className="space-y-1.5 mb-2">
            {!d.tasks.length && <li className="text-[11px] text-ink-400">Nothing planned. Add the next step so it isn&apos;t forgotten.</li>}
            {d.tasks.map(t => {
              const x = due(t.dueAt);
              return (
                <li key={t.id} className="flex items-start gap-2 rounded-control border border-line bg-white px-2.5 py-2">
                  <button onClick={() => void done(t)} disabled={busy} aria-label={`Mark “${t.title}” done`} className="mt-0.5 text-ink-400 hover:text-emerald-600 disabled:opacity-50"><Circle className="w-4 h-4" /></button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-ink-900 break-words">{t.title}</p>
                    <p className={`text-[11px] ${x.late ? "text-red-600 font-semibold" : "text-ink-400"}`}>{x.text}{t.assigneeName ? ` · ${t.assigneeName}` : " · nobody assigned"}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {adding ? (
          <form onSubmit={add} className="space-y-1.5">
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={300} autoFocus placeholder="e.g. Send the price list" className={field} aria-label="Next step" />
            <div className="flex gap-1.5">
              <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={field} aria-label="Due" />
              <select value={who} onChange={e => setWho(e.target.value)} className={field} aria-label="Who does it">
                <option value="">Nobody yet</option>
                {(d?.team ?? []).map(t => <option key={t.id} value={t.id}>{t.name}{t.id === d?.myId ? " (you)" : ""}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 text-[11px] font-semibold text-ink-500">Cancel</button>
              <button disabled={busy || !title.trim()} className="rounded-control bg-brand-700 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50">Add</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} disabled={!d || d.setupPending} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline disabled:opacity-50">
            <Plus className="w-3 h-3" /> Add next step <CalendarClock className="w-3 h-3" />
          </button>
        )}
        {d?.setupPending && <p className="mt-1 text-[11px] text-amber-700">Next steps are still being set up for your workspace.</p>}
        {err && <p role="alert" className="mt-1 text-[11px] text-red-600">{err}</p>}
      </div>
    </div>
  );
}
