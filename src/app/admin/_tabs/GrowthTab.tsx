"use client";

// Growth tools tab — extracted from admin/page.tsx, lazy-loaded.
import { useState, useEffect, useCallback } from "react";
import { Copy, Plus, Trash2, TrendingUp } from "lucide-react";
import { inp } from "../_shared";

// ── Growth tools ──────────────────────────────────────────────────────────────
type GrowthRow = { id: string; name: string; kind: string; slug: string; prefill: string | null; tag: string | null; sequenceId: string | null; config: { number?: string; url?: string; igUsername?: string }; clicks: number; conversions: number; active: boolean };
const GROWTH_KINDS: [string, string][] = [["ref_link", "Referral link"], ["qr", "QR code"], ["widget_popup", "Website popup"], ["widget_bar", "Website bar"], ["landing", "Landing page"]];
const EMPTY_GROWTH = { id: undefined as string | undefined, name: "", kind: "ref_link", slug: "", prefill: "", number: "", igUsername: "", url: "", tag: "", sequenceId: "", active: true };

function GrowthTab() {
  const [tools, setTools] = useState<GrowthRow[]>([]);
  const [seqs, setSeqs] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof EMPTY_GROWTH | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const load = useCallback(() => { fetch("/api/admin/growth").then(r => r.json()).then(d => setTools(d.tools ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); setOrigin(window.location.origin); }, [load]);
  useEffect(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs((d.sequences ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => {}); }, []);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.slug.trim()) { setMsg("Name and slug are required."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/growth", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name: form.name, kind: form.kind, slug: form.slug, prefill: form.prefill || null, tag: form.tag || null, sequenceId: form.sequenceId || null, config: { number: form.number || undefined, igUsername: form.igUsername || undefined, url: form.url || undefined }, active: form.active }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this growth tool?")) return;
    await fetch("/api/admin/growth", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Growth Tools</h2>
          <p className="text-sm text-slate-500">Ref links, QR codes and opt-in widgets that send people into WhatsApp/Instagram with a prefilled message — then start a flow or sequence and tag them.</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_GROWTH }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New tool</button>
      </div>

      {tools.map(t => (
        <div key={t.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{t.name} <span className="text-[10px] font-bold text-ink-400">· {GROWTH_KINDS.find(k => k[0] === t.kind)?.[1] ?? t.kind}</span></p>
            <p className="text-[11px] text-ink-400 font-mono truncate">{origin}/g/{t.slug} · {t.clicks} clicks · {t.conversions} conv.</p>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`${origin}/g/${t.slug}`)} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 flex items-center gap-1"><Copy className="w-3 h-3" /> Link</button>
          <button onClick={() => setForm({ id: t.id, name: t.name, kind: t.kind, slug: t.slug, prefill: t.prefill ?? "", number: t.config?.number ?? "", igUsername: t.config?.igUsername ?? "", url: t.config?.url ?? "", tag: t.tag ?? "", sequenceId: t.sequenceId ?? "", active: t.active })} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(t.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!tools.length && !form && <p className="text-xs text-ink-400">No growth tools yet.</p>}

      {form && (
        <div className="bg-white rounded-card border-2 border-brand-700/30 p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className={inp} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{GROWTH_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <input className={inp} placeholder="Slug (used in /g/slug)" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            <input className={inp} placeholder="Prefilled opt-in message (e.g. GUIDE)" value={form.prefill} onChange={e => setForm({ ...form, prefill: e.target.value })} />
            <input className={inp} placeholder="WhatsApp number (e.g. 9198…)" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} />
            <input className={inp} placeholder="…or Instagram username" value={form.igUsername} onChange={e => setForm({ ...form, igUsername: e.target.value })} />
            <input className={`${inp} col-span-2`} placeholder="…or a full custom URL (overrides the above)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
            <input className={inp} placeholder="Tag the contact on opt-in (optional)" value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} />
            <select className={inp} value={form.sequenceId} onChange={e => setForm({ ...form, sequenceId: e.target.value })}>
              <option value="">Enroll in sequence: none</option>
              {seqs.map(s => <option key={s.id} value={s.id}>Enroll: {s.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save tool"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}

export default GrowthTab;
