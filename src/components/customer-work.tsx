"use client";

// Who looks after this customer, and what's next for them — in Live Chat's side
// panel. The "next action" is the customer's earliest open task (tasks.ts), so
// it always has a person and, ideally, a due date. Tasks added here show up in
// Today for whoever they're given to.

import { useCallback, useEffect, useId, useState } from "react";
import { Circle, Loader2, Plus } from "lucide-react";
import { DetailsRow, DetailsSection, detailsControl } from "@/components/details-section";

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

/** `rows` — further label : control rows shown in the same block as "Looks after". */
export function CustomerWork({ phone, conversationId, rows }: { phone: string; conversationId: string; rows?: React.ReactNode }) {
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
      // Tolerate a partial answer: one odd payload must not take the whole chat screen down.
      setD({ ...j, tasks: Array.isArray(j.tasks) ? j.tasks : [], team: Array.isArray(j.team) ? j.team : [] }); setErr(null); setWho(w => w || j.myId || "");
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

  const field = detailsControl;
  const ownerId = useId();
  return (
    <>
      <div className="space-y-2">
      {rows}
      <DetailsRow label="Looks after" htmlFor={ownerId}>
        {d === null ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-ink-300" aria-label="Loading" /> : d.contact ? (
          d.canManage ? (
            <select id={ownerId} disabled={busy || d.setupPending} value={d.contact.ownerId ?? ""} onChange={e => void setOwner(e.target.value)} className={field} title="Who looks after this customer">
              <option value="">Nobody yet</option>
              {d.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : <p id={ownerId} className="text-[13px] text-ink-800 truncate">{d.team.find(t => t.id === d.contact?.ownerId)?.name ?? "Nobody yet"}</p>
        ) : <p id={ownerId} className="text-[12px] text-ink-500" title="Not saved as a contact yet, so there's no owner. Tasks below still work.">Not a saved contact yet</p>}
      </DetailsRow>
      </div>

      <DetailsSection id="next-steps" title="Next steps" collapsible meta={d?.tasks.length ? d.tasks.length : undefined}>
        {d && (
          <ul className="space-y-1 mb-1.5">
            {!d.tasks.length && <li className="text-[12px] text-ink-500">Nothing planned yet.</li>}
            {d.tasks.map(t => {
              const x = due(t.dueAt);
              return (
                <li key={t.id} className="flex items-start gap-2 rounded-[8px] px-1 py-1 hover:bg-canvas">
                  <button onClick={() => void done(t)} disabled={busy} aria-label={`Mark “${t.title}” done`} className="shrink-0 w-7 h-7 -my-1 flex items-center justify-center rounded-full text-ink-400 hover:text-emerald-600 disabled:opacity-50"><Circle className="w-4 h-4" aria-hidden /></button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink-900 break-words leading-snug">{t.title}</p>
                    <p className={`text-[12px] ${x.late ? "text-red-700 font-semibold" : "text-ink-500"}`}>{x.text}{t.assigneeName ? ` · ${t.assigneeName}` : " · nobody assigned"}</p>
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
              <button type="button" onClick={() => setAdding(false)} className="h-11 md:h-8 lg:h-7 px-2.5 rounded-[8px] text-[13px] font-medium text-ink-600 hover:bg-canvas">Cancel</button>
              <button disabled={busy || !title.trim()} className="h-11 md:h-8 lg:h-7 px-3 rounded-[8px] bg-ink-900 text-[13px] font-semibold text-white disabled:opacity-50">Add</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} disabled={!d || d.setupPending} className="inline-flex items-center gap-1 min-h-11 md:min-h-7 text-[13px] font-medium text-brand-700 hover:underline disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" aria-hidden /> Add next step
          </button>
        )}
        {d?.setupPending && <p className="mt-1 text-[12px] text-amber-800">Next steps are still being set up for your workspace.</p>}
        {err && <p role="alert" className="mt-1 text-[12px] text-red-700">{err}</p>}
      </DetailsSection>
    </>
  );
}
