"use client";

// Handle Hub tab — multiple branded WhatsApp entry points (numbers), each with
// its own set of per-source tracked links + QR codes, so every chat's origin
// is attributed. A tenant can run e.g. a PPC number and an organic number
// side by side, each with its own sources.
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { useVocab } from "@/lib/vocab-client";
import { inp, RailCard, StatRow, EmptyState } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { fmtNum, fmtDay } from "@/lib/format";

interface Source {
  id: string; entryPointId: string; label: string; refCode: string; kind: string; touches: number;
  lastTouchAt: string | null; createdAt: string; link: string | null; qr: string | null;
}
interface EntryPoint {
  id: string; label: string; number: string; handle: string; greeting: string; sources: Source[];
}
const EMPTY_DRAFT = { label: "", number: "", handle: "", greeting: "" };
const KIND_LABEL: Record<string, string> = { qr: "QR", link: "Link", bio: "Bio", ad: "Ad", other: "Other" };

function HandleHubTab() {
  const { vocab } = useVocab();
  const ask = useConfirm();
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
    if (!res.ok) setErr(d.error || "Could not add this number"); else { toast(`${newEp.label.trim() || newEp.number} added — now make a link for each place you'll share it`); setNewEp(EMPTY_DRAFT); load(); }
  }
  async function saveEdit(id: string) {
    const draft = editDraft[id]; if (!draft) return;
    const res = await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryPoint: { id, ...draft } }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || "Save failed"); return; }
    setEditDraft(d => { const n = { ...d }; delete n[id]; return n; });
    setSaved(id); setTimeout(() => setSaved(s => s === id ? null : s), 1500);
    toast("Saved");
    load();
  }
  async function removeEntryPoint(ep: EntryPoint) {
    if (!(await ask({
      title: "Delete this number's links?", tone: "danger", confirmLabel: "Delete",
      message: "Links already shared keep working as plain chat links, but new chats from them will no longer be attributed to any source.",
      facts: [
        { label: "Number", value: ep.label },
        { label: "Tracked links", value: `${ep.sources.length} will stop being attributed` },
      ],
    }))) return;
    const r = await fetch(`/api/admin/handle-hub?entryPointId=${encodeURIComponent(ep.id)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast(`${ep.label || ep.number} deleted`); else toast({ text: "Couldn't delete it. Please try again.", tone: "error" });
    load();
  }
  async function addSource(entryPointId: string) {
    const draft = sourceDraft[entryPointId] ?? { label: "", kind: "qr" };
    if (!draft.label.trim()) return;
    const res = await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: { entryPointId, label: draft.label.trim(), kind: draft.kind } }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error || "Could not create source");
    else { toast(`Link for “${draft.label.trim()}” ready — copy it or download the QR`); setSourceDraft(s => ({ ...s, [entryPointId]: { label: "", kind: draft.kind } })); load(); }
  }
  async function removeSource(id: string, name: string) {
    if (!(await ask({
      title: "Delete this link?", tone: "danger", confirmLabel: "Delete link",
      message: "Its links and QR codes keep working, but new chats from them will no longer be attributed.",
      facts: [{ label: "Link", value: name }],
    }))) return;
    const r = await fetch(`/api/admin/handle-hub?sourceId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast(`“${name}” deleted`); else toast({ text: "Couldn't delete it. Please try again.", tone: "error" });
    load();
  }
  function copy(link: string, id: string) {
    navigator.clipboard?.writeText(link).then(() => { setCopied(id); toast("Link copied"); setTimeout(() => setCopied(null), 1500); }).catch(() => toast({ text: "Couldn't copy — select the link and copy it yourself.", tone: "error" }));
  }

  const allSources = entryPoints.flatMap(ep => ep.sources);
  const totalTouches = allSources.reduce((n, s) => n + (s.touches || 0), 0);

  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">Links &amp; QR Codes</h2><PageInfo className="text-sm text-slate-500" lead={<>Make a separate chat link and QR code for each place you share your WhatsApp number — your Instagram bio, the shop counter, an ad — and see which one each chat came from.</>}>Works on as many WhatsApp numbers as you like.</PageInfo>
        </div>

        {err && <p role="alert" className="text-xs text-red-700">{err}</p>}

        {/* Add a number */}
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-sm font-bold text-ink-900">Add a WhatsApp number</p><p className="text-xs text-slate-500 mt-0.5">Each number gets its own set of links — e.g. one for the number in your paid ads, another for the number on your shop board.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-500">Label</span>
              <input className={`${inp} w-full mt-1`} placeholder="e.g. PPC WhatsApp" value={newEp.label} onChange={e => setNewEp({ ...newEp, label: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">WhatsApp number (with country code)</span>
              <input className={`${inp} w-full mt-1`} inputMode="tel" placeholder="919876500104" value={newEp.number} onChange={e => setNewEp({ ...newEp, number: e.target.value.replace(/\D/g, "") })} />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-slate-500">Prefilled greeting (what the customer&apos;s first message says)</span>
            <input className={`${inp} w-full mt-1`} placeholder="Hi! I'd like to know more." value={newEp.greeting} onChange={e => setNewEp({ ...newEp, greeting: e.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={addEntryPoint} disabled={!newEp.number.trim()} title={!newEp.number.trim() ? "Type the WhatsApp number first" : undefined} className="min-h-10 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">Add number</button>
            {!newEp.number.trim() && <span className="text-[12px] text-slate-500">Type the WhatsApp number to add it.</span>}
          </div>
        </div>

        {/* Per-number sections */}
        {entryPoints.map(ep => {
          const draft = editDraft[ep.id];
          const src = sourceDraft[ep.id] ?? { label: "", kind: "qr" };
          return (
            <div key={ep.id} className="bg-white rounded-card border border-line p-4 space-y-4">
              <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-2">
                {draft ? (
                  <div className="grid sm:grid-cols-3 gap-2 flex-1 max-sm:basis-full min-w-0">
                    <input className={`${inp}`} aria-label="Label" placeholder="Label" value={draft.label} onChange={e => setEditDraft(d => ({ ...d, [ep.id]: { ...draft, label: e.target.value } }))} />
                    <input className={`${inp}`} aria-label="Number" inputMode="tel" placeholder="Number" value={draft.number} onChange={e => setEditDraft(d => ({ ...d, [ep.id]: { ...draft, number: e.target.value.replace(/\D/g, "") } }))} />
                    <input className={`${inp}`} aria-label="Greeting" placeholder="Greeting" value={draft.greeting} onChange={e => setEditDraft(d => ({ ...d, [ep.id]: { ...draft, greeting: e.target.value } }))} />
                  </div>
                ) : (
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-900 truncate">{ep.label}</p>
                    <p className="text-[12px] text-slate-500 mt-0.5">{ep.number}{ep.greeting ? <> · &ldquo;{ep.greeting}&rdquo;</> : null}</p>
                  </div>
                )}
                <div className="flex gap-2 shrink-0 max-sm:ml-auto">
                  {draft ? (
                    <>
                      <button onClick={() => saveEdit(ep.id)} className="min-h-8 px-2 text-xs font-bold text-brand-700 hover:underline">{saved === ep.id ? "Saved" : "Save"}</button>
                      <button onClick={() => setEditDraft(d => { const n = { ...d }; delete n[ep.id]; return n; })} className="min-h-8 px-2 text-xs text-slate-500 hover:underline">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setEditDraft(d => ({ ...d, [ep.id]: { label: ep.label, number: ep.number, handle: ep.handle, greeting: ep.greeting } }))} className="min-h-8 px-2 text-xs font-bold text-brand-700 hover:underline">Edit</button>
                  )}
                  <button onClick={() => removeEntryPoint(ep)} aria-label={`Delete ${ep.label || ep.number}`} className="min-h-8 px-2 text-xs text-red-700 hover:underline">Delete</button>
                </div>
              </div>

              {/* Add a source for this number */}
              <div className="flex flex-wrap gap-2">
                <input className={`${inp} flex-1 min-w-0 max-sm:basis-full`} aria-label="Where this link will be shared" placeholder='Where it lives — e.g. "Instagram bio", "Store counter QR", "Diwali ad"' value={src.label} onChange={e => setSourceDraft(s => ({ ...s, [ep.id]: { ...src, label: e.target.value } }))} onKeyDown={e => { if (e.key === "Enter") addSource(ep.id); }} />
                <select className={inp} aria-label="Kind of link" value={src.kind} onChange={e => setSourceDraft(s => ({ ...s, [ep.id]: { ...src, kind: e.target.value } }))}>
                  <option value="qr">QR</option>
                  <option value="link">Link</option>
                  <option value="bio">Bio</option>
                  <option value="ad">Ad</option>
                  <option value="other">Other</option>
                </select>
                <button onClick={() => addSource(ep.id)} disabled={!src.label.trim()} title={!src.label.trim() ? "Say where this link will be shared first" : undefined} className="min-h-10 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold shrink-0 disabled:opacity-50">Add link</button>
              </div>
              <p className="text-[12px] text-slate-500 -mt-2">If you use a CRM, this name becomes the <b>source</b> of new {vocab.lead.many.toLowerCase()} from this link — for paid ads, use the exact name your reports filter on (e.g. <span className="font-mono">ppc-whatsapp</span>).</p>

              {/* Sources for this number */}
              <div className="space-y-3">
                {ep.sources.map(s => (
                  <div key={s.id} className="border border-line rounded-card p-4 flex flex-wrap sm:flex-nowrap gap-x-4 gap-y-1 items-start">
                    {s.qr
                      ? <a href={s.qr} download={`handle-${s.label.replace(/\s+/g, "-").toLowerCase()}.png`} title="Download QR" aria-label={`Download the QR code for ${s.label}`}><img src={s.qr} alt={`QR code for ${s.label}`} className="w-24 h-24 rounded-lg border border-line shrink-0" /></a>
                      : <div className="w-24 h-24 rounded-lg border border-dashed border-line grid place-items-center text-[11px] text-slate-500 text-center shrink-0">No link yet</div>}
                    <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-7rem)]">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-bold text-ink-900 truncate">{s.label}</p>
                        <span className="text-[11px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 shrink-0">{KIND_LABEL[s.kind] ?? s.kind}</span>
                      </div>
                      <p className="text-[12px] text-slate-500 mt-0.5">{fmtNum(s.touches)} chat{s.touches === 1 ? "" : "s"} started{s.lastTouchAt ? ` · last ${fmtDay(s.lastTouchAt)}` : ""}</p>
                      {s.link && (
                        <div className="flex items-center gap-2 mt-2">
                          <input readOnly value={s.link} aria-label={`Link for ${s.label}`} className="text-[11px] font-mono bg-slate-50 border border-line rounded px-2 py-1 flex-1 min-w-0 text-slate-600" onFocus={e => e.currentTarget.select()} />
                          <button onClick={() => copy(s.link!, s.id)} className="min-h-8 px-2 text-xs font-bold text-brand-700 hover:underline shrink-0">{copied === s.id ? "Copied" : "Copy"}</button>
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeSource(s.id, s.label)} aria-label={`Delete the link ${s.label}`} className="min-h-8 px-2 text-xs text-red-700 hover:underline shrink-0 max-sm:ml-auto">Delete</button>
                  </div>
                ))}
                {ep.sources.length === 0 && <p className="text-center text-slate-500 text-sm py-6 px-4 border border-line rounded-card">No links yet for this number. Type where you&apos;ll share it above — like &ldquo;Instagram bio&rdquo; — and press <b>Add link</b> to get its link and QR code.</p>}
              </div>
            </div>
          );
        })}
        {entryPoints.length === 0 && (
          <div className="bg-white rounded-card border border-line">
            <EmptyState mood="sleeping" title="No numbers added yet"
              body="Add your WhatsApp number above. Then make one link or QR code for each place you share it, and you'll see which one brought in each chat." />
          </div>
        )}
      </div>

      <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
        <RailCard title="At a glance">
          <StatRow label="Numbers" value={entryPoints.length} />
          <StatRow label="Links" value={allSources.length} />
          <StatRow label="Chats attributed" value={totalTouches} />
        </RailCard>
        <RailCard title="How it works">
          <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
            <li>Add each WhatsApp number you run campaigns on.</li>
            <li>Each place you share a number gets its own <b>chat link + QR code</b>.</li>
            <li>The link adds a hidden code to the first message. When the customer sends it, we note where they came from on their {vocab.contact.one.toLowerCase()} — the code never reaches your chatbot.</li>
            <li>New {vocab.lead.many.toLowerCase()} from a link are saved in your <b>CRM under that link&apos;s name</b> — so name a paid-ad link exactly as your report expects (e.g. <span className="font-mono">ppc-whatsapp</span>). Other chats keep the number&apos;s usual source.</li>
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
