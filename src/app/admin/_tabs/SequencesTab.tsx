"use client";

// Sequences (drip) — extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { Database, FileText, Loader2, Plus, Trash2, Workflow, Image as ImageIcon, Video, X } from "lucide-react";
import { inp, ChannelSelect, ImgFallback } from "../_shared";

// ── Sequences (drip) ──────────────────────────────────────────────────────────
type StepDraft = { delayMinutes: number; action: { type: "text" | "template" | "media"; text?: string; templateName?: string; languageCode?: string; mediaKind?: "image" | "video" | "document" | "audio"; url?: string; caption?: string } };
type SeqRow = { id: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string | null; channelId: string | null; active: boolean; steps: { delayMinutes: number; action: StepDraft["action"] }[] };
type SeqDraft = { id?: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string; channelId: string | null; active: boolean; steps: StepDraft[] };
const SEQ_TRIGGERS: [string, string][] = [["manual", "Manual / API"], ["keyword", "Keyword reply"], ["opt_in", "Opt-in (growth tool)"], ["story_reply", "Instagram story reply"], ["comment", "Comment"], ["tag_added", "Tag added"], ["cart_abandoned", "Cart abandoned"], ["order_placed", "Order placed"], ["ad_referral", "Ad referral"]];
const EMPTY_SEQ: SeqDraft = { name: "", platform: "whatsapp", triggerKind: "manual", triggerValue: "", channelId: null, active: true, steps: [{ delayMinutes: 0, action: { type: "text", text: "" } }] };

// Format a step delay (minutes) as a human label for the preview timeline.
function fmtDelay(min: number): string {
  if (!min || min <= 0) return "immediately";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return "after " + [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
}

// Chat-style preview of a sequence — each step shown as the message the contact
// receives, in WhatsApp or Instagram styling, with the wait before each step.
function SequencePreview({ platform, steps }: { platform: "whatsapp" | "instagram"; steps: StepDraft[] }) {
  const ig = platform === "instagram";
  const bubble = ig ? "bg-slate-100 text-slate-800 rounded-2xl rounded-bl-md" : "bg-white text-slate-800 rounded-lg rounded-tl-sm";
  return (
    <div className="xl:w-72 shrink-0">
      <p className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Preview · {ig ? "Instagram" : "WhatsApp"}</p>
      <div className={`rounded-control p-3 space-y-3 ${ig ? "bg-white border border-line" : "bg-[#e5ddd5]"}`}>
        {steps.map((st, i) => {
          const a = st.action;
          return (
            <div key={i} className="space-y-1.5">
              <p className="text-center"><span className="text-[10px] text-slate-500 bg-black/[0.06] rounded-full px-2 py-0.5">⏱ {fmtDelay(st.delayMinutes)}</span></p>
              <div className="flex">
                <div className={`max-w-[85%] px-3 py-2 text-[13px] shadow-sm ${bubble}`}>
                  {a.type === "text" && <p className="whitespace-pre-wrap break-words">{a.text?.trim() || "Empty message…"}</p>}
                  {a.type === "template" && <><p className="font-semibold break-words">📄 {a.templateName?.trim() || "template"}</p><p className="text-[11px] text-slate-400 mt-0.5">approved template message</p></>}
                  {a.type === "media" && <>
                    {a.mediaKind === "image" && a.url
                      ? <ImgFallback url={a.url} imgClass="w-40 h-24 object-cover rounded-md" boxClass="w-40 h-24 bg-slate-200 rounded-md flex items-center justify-center text-slate-400" icon={<ImageIcon className="w-6 h-6" />} />
                      : <div className="w-40 h-24 bg-slate-200 rounded-md flex items-center justify-center text-slate-400">{a.mediaKind === "video" ? <Video className="w-6 h-6" /> : a.mediaKind === "document" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}</div>}
                    {a.caption?.trim() && <p className="break-words mt-1">{a.caption}</p>}
                  </>}
                  <p className="text-[9px] text-slate-400 text-right mt-0.5">10:30</p>
                </div>
              </div>
            </div>
          );
        })}
        {!steps.length && <p className="text-xs text-ink-400 text-center py-4">Add steps to preview the conversation.</p>}
      </div>
    </div>
  );
}

// Run a drip from LeadSquared: pull leads matching an advanced (multi-condition)
// search and enroll them into a sequence. Preview before enrolling.
const LSQ_OPS: [string, string][] = [["eq", "equals"], ["contains", "contains"], ["gt", "after / greater"], ["lt", "before / less"]];
const LSQ_FIELDS = ["ProspectStage", "Source", "Owner", "OwnerIdName", "mx_City", "CreatedOn", "EmailAddress"];
function LsqDripPanel({ seqs }: { seqs: SeqRow[] }) {
  const [conds, setConds] = useState<{ field: string; op: string; value: string }[]>([{ field: "ProspectStage", op: "eq", value: "" }]);
  const [seqId, setSeqId] = useState("");
  const [preview, setPreview] = useState<{ count: number; scanned: number; truncated: boolean; sample: string[] } | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "enroll">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = conds.filter(c => c.field.trim() && c.value.trim());
  const hasAnchor = valid.some(c => c.op === "eq");
  const setCond = (i: number, patch: Partial<{ field: string; op: string; value: string }>) => setConds(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function run(action: "preview" | "enroll") {
    if (action === "enroll") {
      if (!seqId) { setMsg({ ok: false, text: "Pick a sequence to enroll into." }); return; }
      if (!confirm(`Enroll ${preview?.count ?? "the matching"} lead(s) into this drip? They'll receive its messages on schedule.`)) return;
    }
    setBusy(action); setMsg(null); if (action === "preview") setPreview(null);
    try {
      const res = await fetch("/api/admin/leadsquared/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, conditions: valid, sequenceId: seqId || undefined }) });
      const d = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: d.error || "Failed" }); return; }
      if (action === "preview") setPreview(d);
      else setMsg({ ok: true, text: `Enrolled ${d.enrolled} lead(s)${d.skippedOptout ? `, skipped ${d.skippedOptout} opted-out` : ""}${d.truncated ? " (capped at 5000 — refine to reach the rest)" : ""}.` });
    } catch { setMsg({ ok: false, text: "Connection error" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Database className="w-4 h-4 text-brand-700" /> Run a drip from LeadSquared</p>
        <p className="text-[11px] text-ink-400">Pull leads matching these conditions and enroll them into a sequence. Needs ≥1 <b>equals</b> condition (the anchor); the rest refine the list.</p>
      </div>
      <div className="space-y-1.5">
        {conds.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input list="lsq-fields" className={`${inp} flex-1`} placeholder="Field (e.g. ProspectStage)" value={c.field} onChange={e => setCond(i, { field: e.target.value })} />
            <select className={`${inp} w-32 shrink-0`} value={c.op} onChange={e => setCond(i, { op: e.target.value })}>{LSQ_OPS.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
            <input className={`${inp} flex-1`} placeholder="Value (e.g. Prospect)" value={c.value} onChange={e => setCond(i, { value: e.target.value })} />
            {conds.length > 1 && <button onClick={() => setConds(cs => cs.filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>}
          </div>
        ))}
        <datalist id="lsq-fields">{LSQ_FIELDS.map(f => <option key={f} value={f} />)}</datalist>
        {conds.length < 6 && <button onClick={() => setConds(cs => [...cs, { field: "", op: "eq", value: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add condition</button>}
      </div>
      {!hasAnchor && valid.length > 0 && <p className="text-[11px] text-amber-600">Add at least one <b>equals</b> condition — it anchors the LeadSquared search.</p>}
      <div className="flex items-center gap-2">
        <select className={`${inp} flex-1`} value={seqId} onChange={e => setSeqId(e.target.value)}>
          <option value="">Enroll into sequence…</option>
          {seqs.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={() => run("preview")} disabled={!hasAnchor || busy !== ""} className="px-3 py-2 rounded-control border border-brand-700 text-brand-700 text-xs font-bold hover:bg-brand-50 disabled:opacity-50 shrink-0">
          {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Preview count"}
        </button>
        <button onClick={() => run("enroll")} disabled={!hasAnchor || !seqId || busy !== ""} className="px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50 shrink-0">
          {busy === "enroll" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enroll"}
        </button>
      </div>
      {preview && <p className="text-[11px] text-ink-600"><b className="text-brand-700">{preview.count}</b> lead(s) match{preview.truncated ? " (capped at 5000)" : ""} · scanned {preview.scanned}{preview.sample.length ? ` · e.g. ${preview.sample.join(", ")}` : ""}</p>}
      {msg && <p className={`text-[11px] font-semibold ${msg.ok ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p>}
      <p className="text-[10px] text-ink-400">Cold leads (no recent chat) only receive a message if the sequence&apos;s first step is an approved <b>template</b> — the 24h window is closed until they reply. Opt-outs are skipped automatically.</p>
    </div>
  );
}

function SequencesTab() {
  const [seqs, setSeqs] = useState<SeqRow[]>([]);
  const [form, setForm] = useState<SeqDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs(d.sequences ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  function editRow(s: SeqRow) {
    setForm({ id: s.id, name: s.name, platform: s.platform, triggerKind: s.triggerKind, triggerValue: s.triggerValue ?? "", channelId: s.channelId, active: s.active, steps: s.steps.length ? s.steps.map(st => ({ delayMinutes: st.delayMinutes, action: st.action })) : EMPTY_SEQ.steps });
    setMsg(null);
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg("Give the sequence a name."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, triggerValue: form.triggerValue || null }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this sequence? Active enrollments stop.")) return;
    await fetch("/api/admin/sequences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }
  const setStep = (i: number, patch: Partial<StepDraft>) => setForm(f => f ? { ...f, steps: f.steps.map((s, j) => j === i ? { ...s, ...patch } : s) } : f);
  const setStepAction = (i: number, patch: Partial<StepDraft["action"]>) => setForm(f => f ? { ...f, steps: f.steps.map((s, j) => j === i ? { ...s, action: { ...s.action, ...patch } } : s) } : f);

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Workflow className="w-5 h-5" /> Sequences</h2>
          <p className="text-sm text-slate-500">Timed multi-step follow-ups. Triggered by keywords, opt-ins, story replies, abandoned carts, and more — they run automatically and respect the 24-hour window.</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_SEQ }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New sequence</button>
      </div>

      {seqs.map(s => (
        <div key={s.id} className="bg-white rounded-card border border-line p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Workflow className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{s.name} {!s.active && <span className="text-[10px] font-bold text-red-500">· OFF</span>}</p>
            <p className="text-[11px] text-ink-400">{s.platform} · trigger: {SEQ_TRIGGERS.find(t => t[0] === s.triggerKind)?.[1] ?? s.triggerKind}{s.triggerValue ? ` “${s.triggerValue}”` : ""} · {s.steps.length} step{s.steps.length === 1 ? "" : "s"}</p>
          </div>
          <button onClick={() => editRow(s)} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(s.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!seqs.length && !form && <p className="text-xs text-ink-400">No sequences yet.</p>}

      <LsqDripPanel seqs={seqs} />

      {form && (
        <div className="bg-white rounded-card border-2 border-brand-700/30 p-4 flex flex-col xl:flex-row gap-5">
          <div className="flex-1 min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Sequence name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className={inp} value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value as SeqDraft["platform"] })}>
              <option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option>
            </select>
            <select className={inp} value={form.triggerKind} onChange={e => setForm({ ...form, triggerKind: e.target.value })}>
              {SEQ_TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className={inp} placeholder="Trigger value (keyword / tag / ref id)" value={form.triggerValue} onChange={e => setForm({ ...form, triggerValue: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <ChannelSelect value={form.channelId} onChange={v => setForm({ ...form, channelId: v })} allLabel="Channel: default" className={`${inp} !py-1.5 text-xs`} />
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
          </div>

          <p className="text-xs font-bold text-slate-400 uppercase pt-1">Steps</p>
          {form.steps.map((st, i) => (
            <div key={i} className="border border-line rounded-control p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs text-ink-500">
                <span className="font-bold">#{i + 1}</span>
                <span>wait</span>
                <input type="number" min={0} className={`${inp} !py-1 w-20`} value={st.delayMinutes} onChange={e => setStep(i, { delayMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                <span>min, then send</span>
                <select className={`${inp} !py-1`} value={st.action.type} onChange={e => setStepAction(i, { type: e.target.value as StepDraft["action"]["type"] })}>
                  <option value="text">Text</option><option value="template">Template</option><option value="media">Media</option>
                </select>
                <div className="flex-1" />
                {form.steps.length > 1 && <button onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })} className="p-1 text-ink-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
              </div>
              {st.action.type === "text" && <textarea className={`${inp} w-full`} rows={2} placeholder="Message text (sends inside the 24h window)" value={st.action.text ?? ""} onChange={e => setStepAction(i, { text: e.target.value })} />}
              {st.action.type === "template" && <div className="grid grid-cols-2 gap-2"><input className={inp} placeholder="Template name" value={st.action.templateName ?? ""} onChange={e => setStepAction(i, { templateName: e.target.value })} /><input className={inp} placeholder="Language (e.g. en_US)" value={st.action.languageCode ?? ""} onChange={e => setStepAction(i, { languageCode: e.target.value })} /></div>}
              {st.action.type === "media" && <div className="grid grid-cols-2 gap-2"><select className={inp} value={st.action.mediaKind ?? "image"} onChange={e => setStepAction(i, { mediaKind: e.target.value as NonNullable<StepDraft["action"]["mediaKind"]> })}><option value="image">Image</option><option value="video">Video</option><option value="document">Document</option></select><input className={inp} placeholder="Media URL" value={st.action.url ?? ""} onChange={e => setStepAction(i, { url: e.target.value })} /></div>}
            </div>
          ))}
          <button onClick={() => setForm({ ...form, steps: [...form.steps, { delayMinutes: 60, action: { type: "text", text: "" } }] })} className="text-xs font-bold text-brand-700 hover:text-brand-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add step</button>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save sequence"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
            {msg && <span className="text-xs text-red-500">{msg}</span>}
          </div>
          </div>
          <SequencePreview platform={form.platform} steps={form.steps} />
        </div>
      )}
    </div>
  );
}


export default SequencesTab;
