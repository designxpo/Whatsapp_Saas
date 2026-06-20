"use client";

// Sales Pipeline — WhatsApp-native Kanban (stage-on-contact). Extracted as its
// own lazy-loaded tab. Tenant scoping is handled server-side by the APIs.
import { useState, useEffect, useCallback } from "react";
import { KanbanSquare, GripVertical, Plus, Trash2, X, Settings, Loader2, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { inp, type Tab } from "../_shared";

type PStage = { id: string; name: string; position: number; color: string | null; lsqStage: string | null; onEnterTag: string | null; onEnterSequenceId: string | null; isWon: boolean; isLost: boolean };
type PCard = { contactId: string; name: string; phone: string; tags: string[]; stageId: string; lastMessage: string | null; lastInboundAt: string | null };

// One editable stage row in the "Manage stages" panel. Reorder is driven by the
// parent (onReorder) so the closure over the full stage list stays clean.
function StageRow({ stage, seqs, first, last, onReorder, onSaved }: { stage: PStage; seqs: { id: string; name: string }[]; first: boolean; last: boolean; onReorder: (dir: -1 | 1) => void; onSaved: () => void }) {
  const [s, setS] = useState<PStage>(stage);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setS(stage); }, [stage]);
  const dirty = JSON.stringify(s) !== JSON.stringify(stage);
  async function save() {
    setBusy(true);
    await fetch("/api/admin/pipeline/stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }).catch(() => {});
    setBusy(false); onSaved();
  }
  async function del() {
    if (!confirm(`Delete the "${stage.name}" stage? Its leads stay as contacts but drop off the board.`)) return;
    await fetch("/api/admin/pipeline/stages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: stage.id }) }).catch(() => {});
    onSaved();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border border-line rounded-control p-2">
      <input type="color" className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0" value={/^#[0-9a-fA-F]{6}$/.test(s.color || "") ? s.color! : "#64748b"} onChange={e => setS({ ...s, color: e.target.value })} />
      <input className={`${inp} w-32`} value={s.name} maxLength={40} onChange={e => setS({ ...s, name: e.target.value })} placeholder="Stage name" />
      <input className={`${inp} w-36`} value={s.lsqStage ?? ""} onChange={e => setS({ ...s, lsqStage: e.target.value })} placeholder="LeadSquared stage" title="Maps to a LeadSquared ProspectStage (optional)" />
      <input className={`${inp} w-28`} value={s.onEnterTag ?? ""} onChange={e => setS({ ...s, onEnterTag: e.target.value })} placeholder="Tag on enter" />
      <select className={`${inp} w-40`} value={s.onEnterSequenceId ?? ""} onChange={e => setS({ ...s, onEnterSequenceId: e.target.value || null })} title="Enrol into this sequence on entry">
        <option value="">No sequence on enter</option>
        {seqs.map(q => <option key={q.id} value={q.id}>Enrol: {q.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-ink-500"><input type="checkbox" className="accent-brand-700" checked={s.isWon} onChange={e => setS({ ...s, isWon: e.target.checked, isLost: e.target.checked ? false : s.isLost })} /> won</label>
      <label className="flex items-center gap-1 text-[11px] text-ink-500"><input type="checkbox" className="accent-brand-700" checked={s.isLost} onChange={e => setS({ ...s, isLost: e.target.checked, isWon: e.target.checked ? false : s.isWon })} /> lost</label>
      <div className="flex-1" />
      <button onClick={() => onReorder(-1)} disabled={first} className="p-1 text-ink-400 hover:text-ink-900 disabled:opacity-30" title="Move left"><ChevronLeft className="w-4 h-4" /></button>
      <button onClick={() => onReorder(1)} disabled={last} className="p-1 text-ink-400 hover:text-ink-900 disabled:opacity-30" title="Move right"><ChevronRight className="w-4 h-4" /></button>
      {dirty && <button onClick={save} disabled={busy} className="px-2 py-1 rounded-control bg-brand-700 text-white text-[11px] font-bold disabled:opacity-60">{busy ? "…" : "Save"}</button>}
      <button onClick={del} className="p-1 text-ink-400 hover:text-red-600" title="Delete stage"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

function StageManager({ stages, seqs, onChange }: { stages: PStage[]; seqs: { id: string; name: string }[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  async function addStage() {
    setAdding(true);
    await fetch("/api/admin/pipeline/stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "New stage", color: "#64748b" }) }).catch(() => {});
    setAdding(false); onChange();
  }
  async function reorder(ids: string[]) {
    await fetch("/api/admin/pipeline/stages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: ids }) }).catch(() => {});
    onChange();
  }
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-ink-900">Manage stages</p>
        <button onClick={addStage} disabled={adding} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"><Plus className="w-3.5 h-3.5" /> Add stage</button>
      </div>
      <p className="text-[11px] text-ink-400">Columns are your stages. A stage can map to a LeadSquared <b>ProspectStage</b> (synced on move), and fire automation on entry — auto-tag the contact and/or enrol them in a sequence.</p>
      <div className="space-y-2">
        {stages.map((s, i) => (
          <StageRow key={s.id} stage={s} seqs={seqs} first={i === 0} last={i === stages.length - 1}
            onReorder={dir => { const ids = stages.map(x => x.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reorder(ids); }}
            onSaved={onChange} />
        ))}
      </div>
    </div>
  );
}

function AddLeadBox({ onPick, onClose }: { onPick: (contactId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ id: string; name: string; phone: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/admin/contacts?search=${encodeURIComponent(q.trim())}&limit=8`).then(r => r.json()).then(d => setRes((d.contacts ?? []).map((c: { id: string; name: string; phone: string }) => ({ id: c.id, name: c.name, phone: c.phone })))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="border-2 border-brand-700/30 rounded-control p-2 space-y-1.5 bg-white">
      <div className="flex items-center gap-1.5">
        <input autoFocus className={`${inp} flex-1`} placeholder="Search name / number…" value={q} onChange={e => setQ(e.target.value)} />
        <button onClick={onClose} className="p-1 text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
      </div>
      {res.map(c => (
        <button key={c.id} onClick={() => onPick(c.id)} className="w-full text-left px-2 py-1.5 rounded-control hover:bg-canvas">
          <p className="text-xs font-semibold text-ink-900 truncate">{c.name || c.phone}</p>
          <p className="text-[10px] text-ink-400 font-mono truncate">{c.phone}</p>
        </button>
      ))}
      {q.trim().length >= 2 && !res.length && <p className="text-[11px] text-ink-400 px-2 py-1">No matching contacts.</p>}
    </div>
  );
}

export default function PipelineTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [stages, setStages] = useState<PStage[]>([]);
  const [cards, setCards] = useState<PCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [seqs, setSeqs] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/pipeline/board").then(r => r.json()).then(d => { setStages(d.stages ?? []); setCards(d.cards ?? []); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs((d.sequences ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => {}); }, []);

  async function move(contactId: string, stageId: string) {
    const prev = cards;
    setCards(cs => cs.map(c => c.contactId === contactId ? { ...c, stageId } : c));   // optimistic
    const res = await fetch("/api/admin/pipeline/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId, stageId }) }).catch(() => null);
    if (!res || !res.ok) { setCards(prev); return; }
    if (!prev.some(c => c.contactId === contactId)) load();   // newly-added lead → pull it in
  }
  function onDropTo(stageId: string) {
    setOverStage(null);
    const id = dragId; setDragId(null);
    if (!id) return;
    const card = cards.find(c => c.contactId === id);
    if (card && card.stageId !== stageId) move(id, stageId);
  }

  const total = cards.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><KanbanSquare className="w-5 h-5" /> Sales Pipeline</h2>
          <p className="text-sm text-slate-500">Drag a lead between stages. Each card is a contact with their latest WhatsApp message — moving it can auto-tag, start a sequence, and sync the stage to LeadSquared. {total} lead{total === 1 ? "" : "s"} on the board.</p>
        </div>
        <button onClick={() => setManage(m => !m)} className="shrink-0 px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> {manage ? "Done" : "Manage stages"}</button>
      </div>

      {manage && <StageManager stages={stages} seqs={seqs} onChange={load} />}

      {loading ? <div className="flex items-center gap-2 text-sm text-ink-400 py-10"><Loader2 className="w-4 h-4 animate-spin" /> Loading board…</div> : (
        <div className="flex gap-3 overflow-x-auto pb-4 items-start">
          {stages.map(s => {
            const list = cards.filter(c => c.stageId === s.id);
            const accent = /^#[0-9a-fA-F]{6}$/.test(s.color || "") ? s.color! : "#64748b";
            return (
              <div key={s.id}
                onDragOver={e => { e.preventDefault(); setOverStage(s.id); }}
                onDragLeave={() => setOverStage(o => (o === s.id ? null : o))}
                onDrop={() => onDropTo(s.id)}
                className={`w-72 shrink-0 rounded-card border bg-canvas/60 ${overStage === s.id ? "border-brand-600 ring-2 ring-brand-600/30" : "border-line"}`}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accent }} />
                  <p className="text-sm font-bold text-ink-900 truncate flex-1">{s.name}{s.isWon && " ✓"}{s.isLost && " ✕"}</p>
                  <span className="text-[11px] font-bold text-ink-400">{list.length}</span>
                  <button onClick={() => setAddTo(a => (a === s.id ? null : s.id))} className="p-0.5 text-ink-400 hover:text-brand-700" title="Add a lead here"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="p-2 space-y-2 min-h-[80px] max-h-[calc(100vh-260px)] overflow-y-auto">
                  {addTo === s.id && <AddLeadBox onPick={id => { move(id, s.id); setAddTo(null); }} onClose={() => setAddTo(null)} />}
                  {list.map(c => (
                    <div key={c.contactId} draggable
                      onDragStart={() => setDragId(c.contactId)} onDragEnd={() => setDragId(null)}
                      className={`bg-white rounded-control border border-line p-2.5 cursor-grab active:cursor-grabbing ${dragId === c.contactId ? "opacity-50" : "hover:shadow-sm"}`}>
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="w-3.5 h-3.5 text-ink-300 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink-900 truncate">{c.name || c.phone}</p>
                          <p className="text-[10px] text-ink-400 font-mono truncate">{c.phone}</p>
                          {c.lastMessage && <p className="text-[11px] text-ink-500 truncate mt-1">{c.lastMessage}</p>}
                          {!!c.tags.length && <div className="flex flex-wrap gap-1 mt-1.5">{c.tags.slice(0, 3).map(t => <span key={t} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">{t}</span>)}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <select className={`${inp} !py-1 text-[11px] flex-1`} value={c.stageId} onChange={e => move(c.contactId, e.target.value)} title="Move to stage">
                          {stages.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                        </select>
                        <button onClick={() => goTo("livechat")} className="p-1 rounded-control border border-line text-ink-500 hover:bg-canvas shrink-0" title="Open in Live Chat"><ExternalLink className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                  {!list.length && addTo !== s.id && <p className="text-[11px] text-ink-300 text-center py-4">Drop leads here</p>}
                </div>
              </div>
            );
          })}
          {!stages.length && <p className="text-xs text-ink-400">No stages yet — they’ll appear once the pipeline is set up.</p>}
        </div>
      )}
    </div>
  );
}
