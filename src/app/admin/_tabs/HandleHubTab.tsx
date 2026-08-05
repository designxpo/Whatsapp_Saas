"use client";

// Handle Hub tab — multiple branded WhatsApp entry points (numbers), each with
// its own set of per-source tracked links + QR codes, so every chat's origin
// is attributed. A tenant can run e.g. a PPC number and an organic number
// side by side, each with its own sources.
import { useState, useEffect, useCallback } from "react";
import { inp, RailCard, StatRow } from "../_shared";

interface Source {
  id: string; entryPointId: string; label: string; refCode: string; kind: string; touches: number;
  lastTouchAt: string | null; createdAt: string; link: string | null; qr: string | null;
}
interface EntryPoint {
  id: string; label: string; number: string; handle: string; greeting: string; sources: Source[];
}
const EMPTY_DRAFT = { label: "", number: "", handle: "", greeting: "" };

function HandleHubTab() {
  const [entryPoints, setEntryPoints] = useState<EntryPoint[]>([]);
  const [newEp, setNewEp] = useState(EMPTY_DRAFT);
  const [editDraft, setEditDraft] = useState<Record<string, typeof EMPTY_DRAFT>>({});
  const [sourceDraft, setSourceDraft] = useState<Record<string, { label: string; kind: string }>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/handle-hub").then(r => r.json()).then(d => setEntryPoints(d.entryPoints ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addEntryPoint() {
    if (!newEp.number.trim()) { setErr("Enter a WhatsApp number (with country code)."); return; }
    setErr(null);
    const res = await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryPoint: newEp }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error || "Could not add this number"); else { setNewEp(EMPTY_DRAFT); load(); }
  }
  async function saveEdit(id: string) {
    const draft = editDraft[id]; if (!draft) return;
    const res = await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryPoint: { id, ...draft } }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || "Save failed"); return; }
    setEditDraft(d => { const n = { ...d }; delete n[id]; return n; });
    setSaved(id); setTimeout(() => setSaved(s => s === id ? null : s), 1500);
    load();
  }
  async function removeEntryPoint(ep: EntryPoint) {
    if (!confirm(`Delete "${ep.label}"? Its ${ep.sources.length} tracked link(s) will stop being attributed.`)) return;
    await fetch(`/api/admin/handle-hub?entryPointId=${encodeURIComponent(ep.id)}`, { method: "DELETE" });
    load();
  }
  async function addSource(entryPointId: string) {
    const draft = sourceDraft[entryPointId] ?? { label: "", kind: "qr" };
    if (!draft.label.trim()) return;
    const res = await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: { entryPointId, label: draft.label.trim(), kind: draft.kind } }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error || "Could not create source");
    else { setSourceDraft(s => ({ ...s, [entryPointId]: { label: "", kind: draft.kind } })); load(); }
  }
  async function removeSource(id: string, name: string) {
    if (!confirm(`Delete the "${name}" source? Its links/QRs will stop being attributed.`)) return;
    await fetch(`/api/admin/handle-hub?sourceId=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }
  function copy(link: string, id: string) {
    navigator.clipboard?.writeText(link).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  }

  const allSources = entryPoints.flatMap(ep => ep.sources);
  const totalTouches = allSources.reduce((n, s) => n + (s.touches || 0), 0);

  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">Handle Hub</h2>
          <p className="text-sm text-slate-500">Branded WhatsApp entry points — with a tracked link + QR per source, so you know exactly which QR, ad, or post started each conversation. Run this on as many WhatsApp numbers as you like.</p>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        {/* Add a number */}
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-sm font-bold text-ink-900">Add a WhatsApp number</p>
          <p className="text-[11px] text-slate-500">Each number gets its own set of tracked links — e.g. one entry for your PPC number, another for your organic number.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-500">Label</span>
              <input className={`${inp} w-full mt-1`} placeholder="e.g. PPC WhatsApp" value={newEp.label} onChange={e => setNewEp({ ...newEp, label: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">WhatsApp number (with country code)</span>
              <input className={`${inp} w-full mt-1`} placeholder="919555219007" value={newEp.number} onChange={e => setNewEp({ ...newEp, number: e.target.value.replace(/\D/g, "") })} />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-slate-500">Prefilled greeting (what the customer&apos;s first message says)</span>
            <input className={`${inp} w-full mt-1`} placeholder="Hi! I'd like to know more." value={newEp.greeting} onChange={e => setNewEp({ ...newEp, greeting: e.target.value })} />
          </label>
          <button onClick={addEntryPoint} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">Add number</button>
        </div>

        {/* Per-number sections */}
        {entryPoints.map(ep => {
          const draft = editDraft[ep.id];
          const src = sourceDraft[ep.id] ?? { label: "", kind: "qr" };
          return (
            <div key={ep.id} className="bg-white rounded-card border border-line p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                {draft ? (
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    <input className={`${inp}`} placeholder="Label" value={draft.label} onChange={e => setEditDraft(d => ({ ...d, [ep.id]: { ...draft, label: e.target.value } }))} />
                    <input className={`${inp}`} placeholder="Number" value={draft.number} onChange={e => setEditDraft(d => ({ ...d, [ep.id]: { ...draft, number: e.target.value.replace(/\D/g, "") } }))} />
                    <input className={`${inp}`} placeholder="Greeting" value={draft.greeting} onChange={e => setEditDraft(d => ({ ...d, [ep.id]: { ...draft, greeting: e.target.value } }))} />
                  </div>
                ) : (
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-900 truncate">{ep.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{ep.number} · &ldquo;{ep.greeting}&rdquo;</p>
                  </div>
                )}
                <div className="flex gap-2 shrink-0">
                  {draft ? (
                    <>
                      <button onClick={() => saveEdit(ep.id)} className="text-xs font-bold text-brand-700 hover:underline">{saved === ep.id ? "Saved" : "Save"}</button>
                      <button onClick={() => setEditDraft(d => { const n = { ...d }; delete n[ep.id]; return n; })} className="text-xs text-slate-400 hover:underline">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setEditDraft(d => ({ ...d, [ep.id]: { label: ep.label, number: ep.number, handle: ep.handle, greeting: ep.greeting } }))} className="text-xs font-bold text-brand-700 hover:underline">Edit</button>
                  )}
                  <button onClick={() => removeEntryPoint(ep)} className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>

              {/* Add a source for this number */}
              <div className="flex gap-2">
                <input className={`${inp} flex-1`} placeholder='Where it lives — e.g. "Instagram bio", "Store counter QR", "Diwali ad"' value={src.label} onChange={e => setSourceDraft(s => ({ ...s, [ep.id]: { ...src, label: e.target.value } }))} onKeyDown={e => { if (e.key === "Enter") addSource(ep.id); }} />
                <select className={inp} value={src.kind} onChange={e => setSourceDraft(s => ({ ...s, [ep.id]: { ...src, kind: e.target.value } }))}>
                  <option value="qr">QR</option>
                  <option value="link">Link</option>
                  <option value="bio">Bio</option>
                  <option value="ad">Ad</option>
                  <option value="other">Other</option>
                </select>
                <button onClick={() => addSource(ep.id)} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold shrink-0">Add</button>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">The name becomes the <b>CRM lead Source</b> for new leads from this link — for paid WhatsApp ads, name it exactly as your dashboard filters on (e.g. <span className="font-mono">ppc-whatsapp</span>).</p>

              {/* Sources for this number */}
              <div className="space-y-3">
                {ep.sources.map(s => (
                  <div key={s.id} className="border border-line rounded-card p-4 flex gap-4 items-start">
                    {s.qr
                      ? <a href={s.qr} download={`handle-${s.label.replace(/\s+/g, "-").toLowerCase()}.png`} title="Download QR"><img src={s.qr} alt="QR" className="w-24 h-24 rounded-lg border border-line shrink-0" /></a>
                      : <div className="w-24 h-24 rounded-lg border border-dashed border-line grid place-items-center text-[10px] text-slate-400 text-center shrink-0">No link yet</div>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-ink-900 truncate">{s.label}</p>
                        <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{s.kind}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{s.touches} chat{s.touches === 1 ? "" : "s"} started{s.lastTouchAt ? ` · last ${new Date(s.lastTouchAt).toLocaleDateString()}` : ""}</p>
                      {s.link && (
                        <div className="flex items-center gap-2 mt-2">
                          <input readOnly value={s.link} className="text-[11px] font-mono bg-slate-50 border border-line rounded px-2 py-1 flex-1 min-w-0 text-slate-600" onFocus={e => e.currentTarget.select()} />
                          <button onClick={() => copy(s.link!, s.id)} className="text-xs font-bold text-brand-700 hover:underline shrink-0">{copied === s.id ? "Copied" : "Copy"}</button>
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeSource(s.id, s.label)} className="text-xs text-red-500 hover:underline shrink-0">Delete</button>
                  </div>
                ))}
                {ep.sources.length === 0 && <p className="text-center text-slate-400 text-sm py-6 border border-line rounded-card">No sources yet for this number — add one above.</p>}
              </div>
            </div>
          );
        })}
        {entryPoints.length === 0 && <p className="text-center text-slate-400 text-sm py-6 bg-white rounded-card border border-line">Add a WhatsApp number above to start creating tracked links.</p>}
      </div>

      <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
        <RailCard title="At a glance">
          <StatRow label="Numbers" value={entryPoints.length} />
          <StatRow label="Sources" value={allSources.length} />
          <StatRow label="Chats attributed" value={totalTouches} />
        </RailCard>
        <RailCard title="How it works">
          <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
            <li>Each WhatsApp number is its own <b>entry point</b> — add as many as you run campaigns on.</li>
            <li>Each source under a number gets a unique <b>click-to-chat link + QR</b> pointing at that number.</li>
            <li>The link carries a hidden code in the prefilled message. When the customer sends it, we tag their contact with the <b>source</b> and count the touch — it never reaches your chatbot.</li>
            <li>New leads from a source are created in your <b>CRM under that source&apos;s name</b> — so name a paid-ad source exactly as your report expects (e.g. <span className="font-mono">ppc-whatsapp</span>). Organic chats stay the number&apos;s default.</li>
          </ul>
        </RailCard>
        <RailCard title="Coming with WhatsApp usernames">
          <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
            <li>Your <b>@handle</b> becomes the front of every link — no phone number exposed.</li>
            <li>Leads who hide their number still sync to your CRM, matched by handle.</li>
          </ul>
        </RailCard>
      </aside>
    </div>
  );
}

export default HandleHubTab;
