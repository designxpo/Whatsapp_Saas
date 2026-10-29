"use client";

// Settings → Terminology: pick the industry pack, then rename any single term.
// Overrides sit on top of the pack, so switching industry keeps custom names.
import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { inp } from "../_shared";
import { VOCAB_KEYS, type Vocab, type VocabKey, type VocabOverrides } from "@/lib/vocab";
import { useVocab } from "@/lib/vocab-client";

interface Pack { id: string; label: string; vocab: Vocab }
interface State { industry: string; overrides: VocabOverrides; vocab: Vocab; industries: Pack[] }

const ROW_LABEL: Record<VocabKey, string> = {
  contact: "People you talk to", lead: "A new prospect", teamMember: "Your staff", product: "What you sell",
  booking: "A scheduled visit or order", sequence: "Automatic follow-up", pipeline: "The pipeline board",
};

export function TerminologyCard() {
  const { reload } = useVocab();
  const [st, setSt] = useState<State | null>(null);
  const [industry, setIndustry] = useState("generic");
  const [draft, setDraft] = useState<VocabOverrides>({});
  const [busy, setBusy] = useState(false);
  const [note, setMsg] = useNotice();
  const msg = note?.text ?? null;

  const load = useCallback(() => {
    fetch("/api/admin/vocab").then(r => r.json()).then((d: State & { error?: string }) => {
      if (d.error) return;
      setSt(d); setIndustry(d.industry); setDraft(d.overrides);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!st) return <section className="bg-white rounded-card border border-line p-5"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></section>;

  const pack = st.industries.find(p => p.id === industry) ?? st.industries[0];
  const shown = (k: VocabKey) => ({ one: draft[k]?.one ?? pack.vocab[k].one, many: draft[k]?.many ?? (draft[k]?.one ? `${draft[k]!.one}s` : pack.vocab[k].many) });

  function edit(k: VocabKey, side: "one" | "many", value: string) {
    setDraft(d => {
      const next = { ...d, [k]: { ...d[k], [side]: value } };
      // Blank both boxes = back to the pack's wording.
      if (!next[k]![ "one" ] && !next[k]!["many"]) delete next[k];
      return next;
    });
  }

  async function save() {
    setBusy(true); setMsg(null);
    // Only send terms the owner actually changed from the pack.
    const overrides: VocabOverrides = {};
    for (const k of VOCAB_KEYS) {
      const d = draft[k]; if (!d) continue;
      const o: { one?: string; many?: string } = {};
      if (d.one && d.one !== pack.vocab[k].one) o.one = d.one;
      if (d.many && d.many !== pack.vocab[k].many) o.many = d.many;
      if (o.one || o.many) overrides[k] = o;
    }
    try {
      const r = await fetch("/api/admin/vocab", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ industry, overrides }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save");
      setSt(s => (s ? { ...s, ...d } : s)); setDraft(d.overrides); setMsg("Saved — your dashboard now uses these words.", "ok");
      reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-4">
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase">Terminology</p><p className="text-xs text-slate-500 mt-0.5">Pick your industry and the dashboard speaks your language — then rename anything that still doesn&apos;t sound like you.</p>
      </div>
      <select className={`${inp} w-full`} value={industry} onChange={e => { setIndustry(e.target.value); setDraft({}); }} aria-label="Industry">
        {st.industries.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] font-bold uppercase text-slate-400"><span>Used for</span><span>Singular</span><span>Plural</span></div>
        {VOCAB_KEYS.map(k => (
          <div key={k} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
            <span className="text-xs text-slate-500">{ROW_LABEL[k]}</span>
            <input className={inp} maxLength={32} value={shown(k).one} onChange={e => edit(k, "one", e.target.value)} aria-label={`${ROW_LABEL[k]} — singular`} />
            <input className={inp} maxLength={32} value={shown(k).many} onChange={e => edit(k, "many", e.target.value)} aria-label={`${ROW_LABEL[k]} — plural`} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-full text-xs font-bold bg-brand-700 text-white disabled:opacity-60">{busy ? "Saving…" : "Save terminology"}</button>
        {draft && Object.keys(draft).length > 0 && <button onClick={() => setDraft({})} className="text-xs text-slate-500 underline">Reset to {pack.label} defaults</button>}
        <Notice notice={note} />
      </div>
    </section>
  );
}
