"use client";

// A review worked as a complaint case (lib/review-cases.ts): status, owner,
// follow-up date, private notes and history, and — only when a person picks
// and confirms one — the CRM contact behind it. Internal: none of this is ever
// shown to the customer or posted to Google, and a public reply never closes
// the case on its own.

import { useCallback, useEffect, useState } from "react";
import { Clock, Link2, Loader2, MessageSquareText, UserRound, X } from "lucide-react";
import { inp } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast, type ToastInput } from "@/components/toast";

export type CaseStatus = "new" | "in_progress" | "waiting_customer" | "resolved";
export interface CaseFields { id: string; author: string; isComplaint: boolean; assigneeId: string | null; caseStatus: CaseStatus | null; followUpAt: string | null; linkedContactId: string | null }
export interface Teammate { id: string; name: string }

const STATUS: { key: CaseStatus; label: string; tone: string }[] = [
  { key: "new", label: "New", tone: "bg-red-50 text-red-700 border-red-200" },
  { key: "in_progress", label: "In progress", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  { key: "waiting_customer", label: "Waiting on customer", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "resolved", label: "Resolved", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
];
const ACTIVITY_LABEL: Record<string, string> = {
  note: "Note", assigned: "Assignment", status: "Status", follow_up: "Follow-up", contact_linked: "Contact", contact_unlinked: "Contact", reply_posted: "Public reply", reply_removed: "Public reply",
};

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function isOverdue(c: Pick<CaseFields, "caseStatus" | "followUpAt">, now = Date.now()): boolean {
  return !!c.followUpAt && !!c.caseStatus && c.caseStatus !== "resolved" && Date.parse(c.followUpAt) < now;
}

export function ReviewCase({ review, team, canManage, onChanged }: { review: CaseFields; team: Teammate[]; canManage: boolean; onChanged: () => void }) {
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<{ id: string; kind: string; actorName: string | null; body: string; createdAt: string }[] | null>(null);
  const [note, setNote] = useState("");
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ id: string; name: string; phone: string }[]>([]);
  const tracked = !!review.caseStatus;

  const loadActivity = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/activity?id=${encodeURIComponent(review.id)}`).catch(() => null);
    const d = await r?.json().catch(() => ({})) ?? {};
    setActivity(r?.ok ? d.activity ?? [] : []);
  }, [review.id]);
  useEffect(() => { if (open) loadActivity(); }, [open, loadActivity]);

  useEffect(() => {
    if (!linking || q.trim().length < 2) { setMatches([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/reviews/contacts?q=${encodeURIComponent(q.trim())}`).catch(() => null);
      const d = await r?.json().catch(() => ({})) ?? {};
      setMatches(d.contacts ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, linking]);

  async function update(patch: Record<string, unknown>, done: string | ToastInput = "Case updated") {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/reviews/case", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: review.id, ...patch }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "That didn't save. Please try again."); return; }
      toast(done);
      onChanged();
      if (open) loadActivity();
    } finally { setBusy(false); }
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/reviews/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: review.id, body: note }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "The note didn't save. Please try again."); return; }
      setActivity(d.activity ?? []); setNote(""); toast("Note added");
    } finally { setBusy(false); }
  }

  async function link(c: { id: string; name: string; phone: string }) {
    if (!(await ask({
      title: `Link this review to ${c.name || `…${c.phone.slice(-4)}`}?`,
      message: `Only link it if you're sure this customer wrote ${review.author ? `${review.author}'s` : "this"} review — Google doesn't tell Talko who a reviewer is. You can remove the link later.`,
      confirmLabel: "Yes, link them",
    }))) return;
    setLinking(false); setQ("");
    await update({ linkedContactId: c.id }, `Linked to ${c.name || `…${c.phone.slice(-4)}`}`);
  }

  if (!tracked && !review.isComplaint) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => update({ caseStatus: "new" }, "Now tracked as a case")} disabled={busy} className="min-h-8 text-[12px] font-semibold text-ink-600 hover:text-ink-900">Track as a case</button>
        {error && <span className="text-[12px] text-red-700">{error}</span>}
      </div>
    );
  }

  const overdue = isOverdue(review);
  const status = STATUS.find(s => s.key === review.caseStatus);
  return (
    <div className="rounded-control border border-line bg-canvas/40 p-2.5 space-y-2" aria-label="Complaint case">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[11px] font-bold text-ink-500 uppercase tracking-wide">Case</span>
        <label className="sr-only" htmlFor={`case-status-${review.id}`}>Case status</label>
        <select id={`case-status-${review.id}`} disabled={busy} value={review.caseStatus ?? ""} onChange={e => update({ caseStatus: e.target.value || null })}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${status?.tone ?? "bg-white border-line text-ink-600"}`}>
          {!review.caseStatus && <option value="">Not tracked</option>}
          {STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="inline-flex items-center gap-1 text-ink-600">
          <UserRound className="w-3.5 h-3.5" aria-hidden />
          {canManage ? (
            <select aria-label="Assigned to" disabled={busy} value={review.assigneeId ?? ""} onChange={e => update({ assigneeId: e.target.value || null })} className="bg-transparent text-[12px] font-semibold text-ink-700">
              <option value="">Unassigned</option>
              {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : <span className="font-semibold">{team.find(t => t.id === review.assigneeId)?.name ?? "Unassigned"}</span>}
        </span>
        <span className={`inline-flex items-center gap-1 ${overdue ? "text-red-700 font-bold" : "text-ink-600"}`}>
          <Clock className="w-3.5 h-3.5" aria-hidden />
          <label className="sr-only" htmlFor={`case-follow-${review.id}`}>Follow up on</label>
          <input id={`case-follow-${review.id}`} type="date" disabled={busy} value={dateOnly(review.followUpAt)} onChange={e => update({ followUpAt: e.target.value || null })} className="bg-transparent text-[12px]" />
          {overdue && <span>Overdue</span>}
        </span>
        <div className="flex-1" />
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-400" aria-hidden />}
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex min-h-8 items-center gap-1 text-[12px] font-bold text-ink-600 hover:text-ink-900">
          <MessageSquareText className="w-3.5 h-3.5" aria-hidden /> Notes &amp; history
        </button>
      </div>

      {canManage && (
        <div className="text-[12px]">
          {review.linkedContactId ? (
            <span className="inline-flex items-center gap-1.5 text-ink-600">
              <Link2 className="w-3.5 h-3.5" aria-hidden /> Linked to a contact (confirmed by your team)
              <button onClick={() => { const prev = review.linkedContactId; void update({ linkedContactId: null }, { text: "Contact link removed", action: { label: "Undo", onClick: () => void update({ linkedContactId: prev }, "Contact link restored") } }); }} disabled={busy} className="grid h-8 w-8 place-items-center rounded-control text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove contact link"><X className="w-3.5 h-3.5" /></button>
            </span>
          ) : linking ? (
            <div className="space-y-1">
              <input autoFocus className={`${inp} w-full`} placeholder="Search your contacts by name or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Search contacts" />
              {matches.length > 0 && (
                <ul className="rounded-control border border-line bg-white divide-y divide-line">
                  {matches.map(c => <li key={c.id}><button onClick={() => link(c)} className="w-full text-left px-2.5 py-1.5 hover:bg-canvas"><b>{c.name || "No name"}</b> <span className="text-ink-500">…{c.phone.slice(-4)}</span></button></li>)}
                </ul>
              )}
              <button onClick={() => { setLinking(false); setQ(""); }} className="min-h-8 text-[12px] text-ink-600">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setLinking(true)} className="inline-flex min-h-8 items-center gap-1 text-[12px] font-semibold text-ink-500 hover:text-ink-900"><Link2 className="w-3.5 h-3.5" aria-hidden /> Link to a customer in Contacts</button>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-line pt-2">
          {activity === null ? <p className="text-[12px] text-ink-500">Loading…</p>
            : activity.length === 0 ? <p className="text-[12px] text-ink-500">No notes or changes yet.</p>
            : (
              <ol className="space-y-1.5 text-[12px]">
                {activity.map(a => (
                  <li key={a.id} className={a.kind === "note" ? "rounded-control bg-white border border-line px-2.5 py-1.5" : "text-ink-500"}>
                    <span className="font-semibold text-ink-700">{a.actorName || "Talko"}</span> · {ACTIVITY_LABEL[a.kind] ?? a.kind} · <span className="tabular-nums">{when(a.createdAt)}</span>
                    <span className={`block ${a.kind === "note" ? "text-ink-800 whitespace-pre-wrap" : ""}`}>{a.body}</span>
                  </li>
                ))}
              </ol>
            )}
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`case-note-${review.id}`}>Private note</label>
            <textarea id={`case-note-${review.id}`} rows={2} className={`${inp} flex-1`} placeholder="Private note for your team — never shown to the customer" value={note} onChange={e => setNote(e.target.value)} />
            <button onClick={addNote} disabled={busy || !note.trim()} title={!note.trim() ? "Type a note first" : undefined} className="self-end min-h-9 px-3 py-1.5 rounded-control bg-ink-900 text-white text-xs font-bold disabled:opacity-50">Add note</button>
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-red-700" role="alert">{error}</p>}
    </div>
  );
}
