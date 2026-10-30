"use client";

// Team notes in Live Chat's side panel: what the team knows about this lead
// that the chat does not say — "called her, wants the EMI option", "father
// decides, call after 7".
//
// Private by construction (their own table, migration 20261030120000): never sent to
// the customer, never read by the AI, never synced to the CRM. The panel says
// so, and the notes are tinted so nobody mistakes one for a message.

import { useCallback, useEffect, useState } from "react";
import { Loader2, StickyNote, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";

type Note = { id: string; authorEmail: string; authorName: string; body: string; createdAt: string };
const MAX = 2000;

function when(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function ChatNotes({ conversationId }: { conversationId: string }) {
  const ask = useConfirm();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [viewer, setViewer] = useState<{ email: string; isAdmin: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = `/api/admin/conversations/${encodeURIComponent(conversationId)}/notes`;

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNotes(d.notes ?? []); setViewer(d.viewer ?? null); setErr(null);
    } catch (e) { setNotes([]); setErr(e instanceof Error ? e.message : String(e)); }
  }, [url]);
  useEffect(() => { setNotes(null); setDraft(""); void load(); }, [load]);

  async function add() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNotes(n => [...(n ?? []), d.note]);
      setDraft("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  async function remove(n: Note) {
    if (!(await ask({ title: "Delete this note?", tone: "danger", confirmLabel: "Delete note", message: "It is removed for everyone on the team.", facts: [{ label: "Note", value: n.body.length > 80 ? `${n.body.slice(0, 80)}…` : n.body }] }))) return;
    const r = await fetch(`${url}?noteId=${encodeURIComponent(n.id)}`, { method: "DELETE" });
    if (r.ok) setNotes(list => (list ?? []).filter(x => x.id !== n.id));
    else setErr((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  }

  const canDelete = (n: Note) => !!viewer && (viewer.isAdmin || viewer.email === n.authorEmail);

  return (
    <div>
      <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-0.5 flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" /> Team notes</p>
      <p className="text-[11px] text-ink-400 mb-2">Only your team sees these. Never sent to the customer or read by the AI.</p>

      {notes === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : (
        <ul className="space-y-1.5 mb-2">
          {notes.map(n => (
            <li key={n.id} className="group rounded-control bg-amber-50 border border-amber-200 px-2.5 py-2">
              <p className="text-[12.5px] text-ink-900 whitespace-pre-wrap break-words">{n.body}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] text-ink-400 truncate">{n.authorName || n.authorEmail} · {when(n.createdAt)}</span>
                {canDelete(n) && (
                  <button onClick={() => void remove(n)} aria-label="Delete note" className="ml-auto p-0.5 rounded text-ink-400 hover:text-red-600 opacity-60 group-hover:opacity-100 focus-visible:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <textarea value={draft} onChange={e => setDraft(e.target.value.slice(0, MAX))} rows={2}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); } }}
        placeholder="Add a note for your team…" aria-label="Add a team note"
        className="w-full border border-line rounded-control px-2.5 py-1.5 text-xs resize-y bg-white" />
      <div className="flex items-center gap-2 mt-1">
        <button onClick={() => void add()} disabled={busy || !draft.trim()} className="px-3 py-1.5 rounded-control bg-ink-900 hover:bg-ink-950 text-white text-xs font-bold disabled:opacity-40">
          {busy ? "Saving…" : "Add note"}
        </button>
        <span className="text-[11px] text-ink-400">Ctrl/⌘ + Enter</span>
      </div>
      {err && <p className="text-[11px] font-semibold text-amber-800 mt-1.5">{err}</p>}
    </div>
  );
}
