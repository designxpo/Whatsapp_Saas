"use client";

// Sequences (drip) — extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { Database, FileText, Loader2, Plus, Trash2, Workflow, Image as ImageIcon, Video, X, FlaskConical, Send, Zap, RefreshCw, Sparkles } from "lucide-react";
import { inp, ChannelSelect, ImgFallback } from "../_shared";

// ── Sequences (drip) ──────────────────────────────────────────────────────────
type StepDraft = { delayMinutes: number; action: { type: "text" | "template" | "media"; text?: string; templateName?: string; languageCode?: string; mediaKind?: "image" | "video" | "document" | "audio"; url?: string; caption?: string } };
type SeqRow = { id: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string | null; channelId: string | null; active: boolean; steps: { delayMinutes: number; action: StepDraft["action"] }[] };
type SeqDraft = { id?: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string; channelId: string | null; active: boolean; steps: StepDraft[] };
const SEQ_TRIGGERS: [string, string][] = [["manual", "Manual / API"], ["keyword", "Keyword reply"], ["opt_in", "Opt-in (growth tool)"], ["story_reply", "Instagram story reply"], ["comment", "Comment"], ["tag_added", "Tag added"], ["cart_abandoned", "Cart abandoned"], ["order_placed", "Order placed"], ["ad_referral", "Ad referral"], ["inactivity", "Inactivity (no reply) — trigger value = minutes of silence before the first nudge"]];
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

// Auto-drip by LeadSquared stage (Phase 6): when a lead's LSQ stage changes
// (delivered by the LSQ→portal webhook), the mapped sequence starts and other
// stage-managed sequences stop. Config in wa_settings via /api/admin/stage-drips.
// Landing-page form → WhatsApp flow. A cold web-form lead can't be sent free-form
// messages, so this sends an approved TEMPLATE on the LeadSquared event and ARMS
// the question flow for the reply. Per-tenant config via /api/admin/lead-welcome.
type LeadWelcomeCfg = { enabled: boolean; templateName: string; languageCode: string; nameParam: boolean; flowId: string; trigger: string; sourceContains: string };
function LeadWelcomePanel() {
  const [cfg, setCfg] = useState<LeadWelcomeCfg | null>(null);
  const [flows, setFlows] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { fetch("/api/admin/lead-welcome").then(r => r.json()).then(d => setCfg(d.config ?? null)).catch(() => setCfg(null)); }, []);
  useEffect(() => { fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows((d.flows ?? []).filter((f: { platform?: string }) => !f.platform || f.platform === "whatsapp" || f.platform === "all"))).catch(() => {}); }, []);

  async function save() {
    if (!cfg) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/lead-welcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).then(r => r.json());
      if (d.error) setMsg(d.error); else { setCfg(d.config); setMsg("Saved ✓"); }
    } finally { setBusy(false); }
  }
  if (!cfg) return null;
  const set = (p: Partial<LeadWelcomeCfg>) => setCfg(c => c ? { ...c, ...p } : c);
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Zap className="w-4 h-4 text-brand-700" /> Landing-page form → WhatsApp flow</p>
          <p className="text-[11px] text-ink-400">When a form lead arrives from LeadSquared, send an approved <b>template</b> and start your <b>question flow</b> the moment they reply. Cold web leads can&apos;t be messaged free-form — the template opens the 24h window, then the flow runs.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-700 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} /> On</label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className={`${inp} !py-1.5 text-xs`} placeholder="Approved template name" value={cfg.templateName} onChange={e => set({ templateName: e.target.value })} />
        <input className={`${inp} !py-1.5 text-xs`} placeholder="Template language (e.g. en / en_US)" value={cfg.languageCode} onChange={e => set({ languageCode: e.target.value })} />
        <select className={`${inp} !py-1.5 text-xs`} value={cfg.flowId} onChange={e => set({ flowId: e.target.value })}>
          <option value="">Pick the question flow…</option>
          {flows.map(f => <option key={f.id} value={f.id}>{f.name}{f.active ? "" : " (inactive)"}</option>)}
        </select>
        <select className={`${inp} !py-1.5 text-xs`} value={cfg.trigger === "created" ? "created" : "stage"} onChange={e => set({ trigger: e.target.value === "created" ? "created" : "" })}>
          <option value="created">Fire on: new lead created</option>
          <option value="stage">Fire on: lead enters a stage</option>
        </select>
        {cfg.trigger !== "created" && <input className={`${inp} !py-1.5 text-xs`} placeholder="LSQ stage name (exact)" value={cfg.trigger} onChange={e => set({ trigger: e.target.value })} />}
        <input className={`${inp} !py-1.5 text-xs`} placeholder="Only if Source contains… (optional)" value={cfg.sourceContains} onChange={e => set({ sourceContains: e.target.value })} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={cfg.nameParam} onChange={e => set({ nameParam: e.target.checked })} /> template uses {"{{1}}"} = lead&apos;s first name</label>
        <div className="flex-1" />
        <button onClick={save} disabled={busy} className="px-3 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "…" : "Save"}</button>
        {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
      </div>
      <p className="text-[11px] text-ink-400">Point your signup form&apos;s LeadSquared automation at the LSQ→portal webhook (Integrations → LeadSquared). Each lead is welcomed once per 30 days; opted-out numbers are skipped.</p>
    </div>
  );
}

function StageDripsPanel({ seqs }: { seqs: SeqRow[] }) {
  const [drips, setDrips] = useState<{ stage: string; sequenceId: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { fetch("/api/admin/stage-drips").then(r => r.json()).then(d => setDrips(d.drips ?? [])).catch(() => setDrips([])); }, []);

  async function save() {
    if (!drips) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/stage-drips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drips: drips.filter(x => x.stage.trim() && x.sequenceId) }) }).then(r => r.json());
      if (d.error) setMsg(d.error);
      else { setDrips(d.drips ?? []); setMsg("Saved ✓"); }
    } finally { setBusy(false); }
  }

  if (drips === null) return null;
  const clash = drips.some((d, i) => d.stage.trim() && drips.findIndex(x => x.stage.trim().toLowerCase() === d.stage.trim().toLowerCase()) !== i);
  const waSeqs = seqs.filter(s => s.platform === "whatsapp");
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Database className="w-4 h-4 text-brand-700" /> Auto-drip by LeadSquared stage</p>
        <p className="text-[11px] text-ink-400">When a lead&apos;s LSQ stage changes (via the LSQ→portal webhook), start that stage&apos;s sequence — and stop the other stage-managed ones (the lead moved on). Stage names must match LSQ&apos;s ProspectStage exactly (case-insensitive). Opted-out leads are never enrolled.</p>
      </div>
      {drips.map((d, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <input className={`${inp} !py-1.5 text-xs w-44`} placeholder="LSQ stage, e.g. RNR" value={d.stage}
            onChange={e => setDrips(a => (a ?? []).map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)))} />
          <span className="text-[11px] text-ink-400">→</span>
          <select className={`${inp} !py-1.5 text-xs`} value={d.sequenceId}
            onChange={e => setDrips(a => (a ?? []).map((x, j) => (j === i ? { ...x, sequenceId: e.target.value } : x)))}>
            <option value="">Pick a sequence…</option>
            {waSeqs.map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (inactive)"}</option>)}
          </select>
          <button onClick={() => setDrips(a => (a ?? []).filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDrips(a => [...(a ?? []), { stage: "", sequenceId: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add stage rule</button>
        <button onClick={save} disabled={busy || clash} className="px-3 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "…" : "Save rules"}</button>
        {clash && <span className="text-[11px] text-red-500">Duplicate stage.</span>}
        {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
      </div>
      <p className="text-[11px] text-ink-400">Cold leads are usually outside Meta&apos;s 24h window — make each mapped sequence&apos;s <b>step 1 an approved template</b> or it will be skipped.</p>
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

// Test + monitor a drip: enroll one number on demand, force the due steps to run
// (without waiting for the cron), and watch every enrollment's progress + errors.
type EnrRow = { id: string; sequenceName: string; phone: string; platform: string; currentStep: number; status: string; nextRunAt: string | null; lastError: string | null; updatedAt: string | null };
function fmtWhen(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s); if (isNaN(d.getTime())) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff), m = Math.round(abs / 60000), h = Math.round(abs / 3600000), days = Math.round(abs / 86400000);
  const rel = m < 1 ? "now" : m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${days}d`;
  return diff >= 0 ? `in ${rel}` : `${rel} ago`;
}
const ENR_BADGE: Record<string, string> = { active: "bg-blue-50 text-blue-600", completed: "bg-emerald-50 text-emerald-600", stopped: "bg-slate-100 text-slate-500", failed: "bg-red-50 text-red-600" };
function SeqMonitorPanel({ seqs }: { seqs: SeqRow[] }) {
  const [enr, setEnr] = useState<EnrRow[]>([]);
  const [seqId, setSeqId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"" | "test" | "run" | "refresh">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [contacts, setContacts] = useState<{ phone: string; name: string; withinWindow: boolean }[]>([]);
  const loadEnr = useCallback(() => { fetch("/api/admin/sequences/enrollments").then(r => r.json()).then(d => setEnr(d.enrollments ?? [])).catch(() => {}); }, []);
  useEffect(() => { loadEnr(); }, [loadEnr]);

  // The picked sequence drives the platform — and the test sends on THAT platform
  // (a WhatsApp sequence can't reach Instagram). Load valid contacts for it.
  const selSeq = seqs.find(s => s.id === seqId) || null;
  const platform = selSeq?.platform ?? "whatsapp";
  useEffect(() => {
    if (!seqId) { setContacts([]); return; }
    fetch(`/api/admin/sequences/test-contacts?platform=${platform}`).then(r => r.json()).then(d => setContacts(d.contacts ?? [])).catch(() => setContacts([]));
  }, [seqId, platform]);

  async function testEnroll() {
    if (!seqId) { setMsg({ ok: false, text: "Pick a sequence to test." }); return; }
    if (!phone.trim()) { setMsg({ ok: false, text: platform === "instagram" ? "Pick an Instagram contact (you can't message a handle)." : "Enter a WhatsApp number to test with." }); return; }
    setBusy("test"); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences/test-enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequenceId: seqId, phone }) });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: d.note || "Enrolled." } : { ok: false, text: d.error || "Failed" });
      loadEnr();
    } catch { setMsg({ ok: false, text: "Connection error" }); }
    finally { setBusy(""); }
  }
  async function runNow() {
    setBusy("run"); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences/run", { method: "POST" });
      const d = await res.json();
      setMsg(res.ok ? { ok: true, text: `Processed ${d.processed} due step(s) now.` } : { ok: false, text: d.error || "Failed" });
      loadEnr();
    } catch { setMsg({ ok: false, text: "Connection error" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><FlaskConical className="w-4 h-4 text-brand-700" /> Test &amp; monitor</p>
        <p className="text-[11px] text-ink-400">Enroll your own number to test a drip, force due steps to send now (instead of waiting for the scheduler), and watch every enrollment below.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inp} flex-1 min-w-[10rem]`} value={seqId} onChange={e => { setSeqId(e.target.value); setPhone(""); setMsg(null); }}>
          <option value="">Test sequence…</option>
          {seqs.map(s => <option key={s.id} value={s.id}>{s.name}{!s.active ? " (off)" : ""}</option>)}
        </select>
        {selSeq && <span className={`px-2 py-1.5 rounded-control text-[11px] font-bold shrink-0 ${platform === "instagram" ? "bg-pink-50 text-pink-600" : "bg-emerald-50 text-emerald-700"}`}>sends on {platform === "instagram" ? "Instagram" : "WhatsApp"}</span>}
        {seqId && (
          <select className={`${inp} w-48`} value="" onChange={e => { if (e.target.value) setPhone(e.target.value); }}>
            <option value="">{contacts.length ? "Pick a contact who messaged you…" : "No contacts on this platform yet"}</option>
            {contacts.map(c => <option key={c.phone} value={c.phone}>{c.name}{c.withinWindow ? " ✅" : ""}</option>)}
          </select>
        )}
        <input className={`${inp} w-44`} placeholder={platform === "instagram" ? "IG id — pick a contact ↑" : "WhatsApp number"} value={phone} onChange={e => setPhone(e.target.value)} />
        <button onClick={testEnroll} disabled={busy !== "" || !seqId} className="px-3 py-2 rounded-control border border-brand-700 text-brand-700 text-xs font-bold hover:bg-brand-50 disabled:opacity-50 shrink-0 flex items-center gap-1.5">{busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enroll &amp; send</button>
        <button onClick={runNow} disabled={busy !== ""} className="px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50 shrink-0 flex items-center gap-1.5">{busy === "run" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Run due steps now</button>
        <button onClick={loadEnr} className="p-2 rounded-control border border-line text-ink-500 hover:bg-canvas shrink-0" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      {msg && <p className={`text-[11px] font-semibold ${msg.ok ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p>}
      <p className="text-[10px] text-ink-400">The test sends on the <b>sequence&apos;s platform</b> — to test Instagram, pick an <b>Instagram</b> sequence. Instagram can only message someone who <b>DMed your IG first</b> (so pick them from the list — you can&apos;t message a @handle). <b>✅</b> = messaged in the last 24h, so a plain <b>text</b> step will deliver; otherwise use an approved <b>template</b> step.</p>

      {/* Enrollment monitor */}
      <div className="border border-line rounded-control overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-canvas text-[10px] font-bold text-ink-400 uppercase">
          <div className="col-span-3">Sequence</div><div className="col-span-3">Contact</div><div className="col-span-2">Step</div><div className="col-span-2">Status</div><div className="col-span-2">Next / error</div>
        </div>
        {enr.length === 0 && <p className="px-3 py-3 text-xs text-ink-400">No enrollments yet. Enroll a number above, or wire a trigger (keyword / growth tool) and have someone message you.</p>}
        {enr.map(e => (
          <div key={e.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-line text-[12px] items-center">
            <div className="col-span-3 truncate font-medium text-ink-800">{e.sequenceName}</div>
            <div className="col-span-3 truncate font-mono text-ink-600">{e.phone}<span className="text-ink-300"> · {e.platform === "instagram" ? "IG" : "WA"}</span></div>
            <div className="col-span-2 text-ink-600">#{(e.currentStep ?? 0) + 1}</div>
            <div className="col-span-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ENR_BADGE[e.status] ?? "bg-slate-100 text-slate-500"}`}>{e.status}</span></div>
            <div className="col-span-2 truncate text-[11px]">{e.lastError ? <span className="text-red-600" title={e.lastError}>⚠ {e.lastError}</span> : <span className="text-ink-400">{e.status === "active" ? fmtWhen(e.nextRunAt) : fmtWhen(e.updatedAt)}</span>}</div>
          </div>
        ))}
      </div>
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

      {/* How a sequence actually fires — the part that's easy to miss. */}
      <div className="bg-brand-50/60 border border-brand-700/15 rounded-card p-4 text-[12px] text-ink-700 space-y-1.5">
        <p className="font-bold text-ink-900 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-brand-700" /> How a sequence runs</p>
        <p><b>1. A trigger enrols someone.</b> A sequence does nothing on its own — it needs an entry point: a <b>keyword</b> they send, a <b>growth tool</b> opt-in, an Instagram <b>story reply</b>, a cart/order event, or the <b>Test</b> box below. Set the trigger on the sequence, then make sure that path exists.</p>
        <p><b>2. The schedule sends the steps.</b> A background job runs <b>every ~5 minutes</b> and delivers each step once its wait is up. <b>Step 1&apos;s wait</b> counts from enrolment (0 = send immediately); every later step&apos;s wait counts from the previous step.</p>
        <p><b>3. The 24-hour rule applies.</b> Plain <b>text/media</b> steps only deliver if the contact messaged you in the last 24h. To reach people outside that window, make the step an approved <b>template</b>.</p>
        <p className="text-ink-400">Not sure it&apos;s working? Use <b>Test &amp; monitor</b> below — enroll your own number and click <b>Run due steps now</b>.</p>
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

      <SeqMonitorPanel seqs={seqs} />
      <LeadWelcomePanel />
      <StageDripsPanel seqs={seqs} />
      <LsqDripPanel seqs={seqs} />

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={() => setForm(null)}>
        <div onClick={e => e.stopPropagation()} className="bg-white rounded-card border border-line shadow-float p-4 my-8 w-full max-w-3xl flex flex-col xl:flex-row gap-5">
          <div className="flex-1 min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Sequence name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className={inp} value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value as SeqDraft["platform"], channelId: null })}>
              <option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option>
            </select>
            <select className={inp} value={form.triggerKind} onChange={e => setForm({ ...form, triggerKind: e.target.value })}>
              {SEQ_TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className={inp} placeholder="Trigger value (keyword / tag / ref id)" value={form.triggerValue} onChange={e => setForm({ ...form, triggerValue: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <ChannelSelect kind={form.platform} value={form.channelId} onChange={v => setForm({ ...form, channelId: v })} allLabel={form.platform === "instagram" ? "Account: default" : "Number: default"} className={`${inp} !py-1.5 text-xs`} />
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
        </div>
      )}
    </div>
  );
}


export default SequencesTab;
