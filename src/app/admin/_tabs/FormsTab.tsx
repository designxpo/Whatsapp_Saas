"use client";

// WhatsApp Forms tab (FormsRail + form types + responses + builder) — extracted
// from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Check, ClipboardList, ExternalLink, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { type Tab, inp, btnPrimary, RailCard, StatRow, ChannelSelect } from "../_shared";

function FormsRail({ goTo, forms }: { goTo: (t: Tab) => void; forms: { status: string }[] }) {
  const c = (s: string) => forms.filter(f => f.status === s).length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Form status">
        <StatRow label="Published — live" value={c("PUBLISHED")} />
        <StatRow label="Drafts" value={c("DRAFT")} tone={c("DRAFT") > 0 ? "warn" : undefined} />
        <StatRow label="Deprecated" value={c("DEPRECATED")} />
      </RailCard>
      <RailCard title="From build to lead">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li><b>Build</b> — name, title, and fields (text, phone, email, dropdown, date…).</li>
          <li><b>Publish</b> — pushed to Meta; the form opens natively inside WhatsApp.</li>
          <li><b>Use</b> — drag the <b>WhatsApp form</b> block into a chatbot flow.</li>
          <li><b>Collect</b> — every answer saves to the contact&apos;s attributes automatically.</li>
        </ol>
        <button onClick={() => goTo("flows")} className="text-[11px] font-bold text-brand-700 flex items-center gap-1">Open Chatbot Flows <ArrowRight className="w-3 h-3" /></button>
      </RailCard>
      <RailCard title="Where answers show up">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li><b>Live Chat</b> — right panel, under &quot;Details collected&quot;.</li>
          <li><b>Contacts</b> — as attributes you can filter and broadcast by.</li>
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Short forms convert best — 3–5 fields.</li>
          <li>Published forms can&apos;t be edited — create a new version, deprecate the old.</li>
          <li>Mark only truly essential fields as required.</li>
        </ul>
      </RailCard>
    </aside>
  );
}
// ── WhatsApp Forms (Meta Flows — native in-chat forms) ────────────────────────
type WaFormRow = { id: string; name: string; status: string; categories: string[]; validationErrors: string[]; previewUrl: string | null };
type UiFormFieldType = "text" | "email" | "phone" | "number" | "textarea" | "dropdown" | "radio" | "checkbox" | "date" | "optin";
type UiFormField = { type: UiFormFieldType; label: string; required: boolean; options: string };

const FORM_FIELD_TYPES: { v: UiFormFieldType; label: string }[] = [
  { v: "text", label: "Text" }, { v: "email", label: "Email" }, { v: "phone", label: "Phone" },
  { v: "number", label: "Number" }, { v: "textarea", label: "Long text" }, { v: "dropdown", label: "Dropdown" },
  { v: "radio", label: "Single choice" }, { v: "checkbox", label: "Multi choice" },
  { v: "date", label: "Date" }, { v: "optin", label: "Opt-in tick" },
];
const isChoice = (t: UiFormFieldType) => t === "dropdown" || t === "radio" || t === "checkbox";

type FormResp = { id: string; phone: string; formId: string | null; status: string; data: Record<string, string> | null; sentAt: string; submittedAt: string | null };
function FormResponsesPanel() {
  const [responses, setResponses] = useState<FormResp[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { fetch("/api/admin/form-responses").then(r => r.json()).then(d => setResponses(d.responses ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const submitted = responses.filter(r => r.status === "submitted").length;
  const abandoned = responses.filter(r => r.status === "abandoned").length;
  const badge = (s: string) => s === "submitted" ? "bg-emerald-50 text-emerald-700" : s === "abandoned" ? "bg-amber-50 text-amber-700" : "bg-canvas text-ink-400";
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="text-sm font-bold text-ink-900 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-brand-700" /> Form responses</span>
        <span className="text-[11px] text-ink-400">{submitted} submitted · {abandoned} abandoned · {open ? "hide" : "show"}</span>
      </button>
      {open && (responses.length ? (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {responses.map(r => (
            <div key={r.id} className="border border-line rounded-control px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink-900 truncate">{r.phone || "—"}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${badge(r.status)}`}>{r.status.toUpperCase()}</span>
              </div>
              {r.data && Object.keys(r.data).length > 0 && <p className="text-[11px] text-ink-500 mt-0.5 break-words">{Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
              <p className="text-[10px] text-ink-400 mt-0.5">{new Date(r.submittedAt ?? r.sentAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-ink-400">No form responses yet.</p>)}
    </section>
  );
}

function FormsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [forms, setForms] = useState<WaFormRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<UiFormField[]>([
    { type: "text", label: "Full name", required: true, options: "" },
    { type: "phone", label: "Mobile number", required: true, options: "" },
  ]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);   // which number's WABA
  const [editingId, setEditingId] = useState<string | null>(null);   // editing a draft in place
  const [cloneNote, setCloneNote] = useState<string | null>(null);   // editing a copy of a published form

  function resetBuilder() {
    setName(""); setTitle(""); setEditingId(null); setCloneNote(null);
    setFields([{ type: "text", label: "Full name", required: true, options: "" }, { type: "phone", label: "Mobile number", required: true, options: "" }]);
  }

  // Open an existing form in the builder. Drafts edit in place; published forms
  // are immutable on Meta, so we pre-fill a COPY that saves as a new form.
  async function openEdit(f: WaFormRow) {
    setMsg(null); setBusy("load:" + f.id);
    try {
      const d = await fetch(`/api/admin/waforms?def=${f.id}${channelId ? `&channelId=${channelId}` : ""}`).then(r => r.json());
      if (d.error) { setMsg(d.error); return; }
      const published = f.status === "PUBLISHED";
      setName(published ? `${f.name} copy` : f.name);
      setTitle(d.title || "");
      setFields((d.fields ?? []).map((x: { type: UiFormFieldType; label: string; required: boolean; options?: string[] }) => ({ type: x.type, label: x.label, required: x.required, options: (x.options ?? []).join(", ") })));
      setEditingId(published ? null : f.id);
      setCloneNote(published ? f.name : null);
      setShowBuilder(true);
    } finally { setBusy(null); }
  }

  // Save edits to an existing draft (re-uploads its Flow JSON).
  async function update(publish: boolean) {
    setMsg(null);
    if (!fields.some(f => f.label.trim())) { setMsg("Add at least one field."); return; }
    setBusy(publish ? "publish" : "draft");
    try {
      const res = await fetch("/api/admin/waforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId, name: name.trim(), title: title.trim() || name.trim(), publish, channelId,
          fields: fields.filter(f => f.label.trim()).map(f => ({ type: f.type, label: f.label.trim(), required: f.required, options: f.options.split(",").map(s => s.trim()).filter(Boolean) })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed"); return; }
      if (d.validationErrors?.length) setMsg(`Saved as draft, but Meta flagged: ${d.validationErrors.join(" · ")}`);
      else if (d.publishError) setMsg(`Saved — publishing failed: ${d.publishError}`);
      else setMsg(d.status === "PUBLISHED" ? "Updated & published ✓" : "Draft updated ✓");
      resetBuilder();
      load();
    } finally { setBusy(null); }
  }

  // Rename a form (works on published too — only content is locked once live).
  async function renameForm(f: WaFormRow) {
    const next = prompt("Rename form", f.name);
    if (next == null || !next.trim() || next.trim() === f.name) return;
    setBusy("rename:" + f.id); setMsg(null);
    try {
      const res = await fetch("/api/admin/waforms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, rename: next.trim(), channelId }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Rename failed"); else { setMsg("Renamed ✓"); load(); }
    } finally { setBusy(null); }
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetch(`/api/admin/waforms${channelId ? `?channelId=${channelId}` : ""}`).then(r => r.json());
      setForms(d.forms ?? []); setNotice(d.notice ?? null);
    } catch { /* keep last list */ }
    setRefreshing(false);
  }, [channelId]);
  useEffect(() => { load(); }, [load]);

  const setField = (i: number, patch: Partial<UiFormField>) => setFields(fs => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  async function create(publish: boolean) {
    setMsg(null);
    if (!name.trim()) { setMsg("Give the form a name."); return; }
    if (!fields.some(f => f.label.trim())) { setMsg("Add at least one field."); return; }
    setBusy(publish ? "publish" : "draft");
    try {
      const res = await fetch("/api/admin/waforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), title: title.trim() || name.trim(), publish, channelId,
          fields: fields.filter(f => f.label.trim()).map(f => ({ type: f.type, label: f.label.trim(), required: f.required, options: f.options.split(",").map(s => s.trim()).filter(Boolean) })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed"); return; }
      if (d.validationErrors?.length) setMsg(`Created as draft, but Meta flagged: ${d.validationErrors.join(" · ")}`);
      else if (d.publishError) setMsg(`Created as draft — publishing failed: ${d.publishError}`);
      else setMsg(d.status === "PUBLISHED" ? "Published — the form is live. Use it from the WhatsApp form block in your chatbot flows." : "Draft created — publish when ready.");
      resetBuilder();
      load();
    } finally { setBusy(null); }
  }

  async function publish(id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/waforms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, publish: true, channelId }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Publish failed"); else setMsg("Published — the form is live.");
      load();
    } finally { setBusy(null); }
  }

  // Clone + publish this form onto every OTHER connected number's WABA so a
  // chatbot flow can send it natively from any number (not just the one it was
  // built on). A WhatsApp form is tied to one WABA; this replicates it per WABA.
  async function publishAll(f: WaFormRow) {
    if (!confirm(`Publish a copy of "${f.name}" to every other connected number, so flows can send this form natively from any number?`)) return;
    setBusy("all:" + f.id); setMsg(null);
    try {
      const res = await fetch("/api/admin/waforms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, publishToAll: true, channelId }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Publish to all failed"); return; }
      if (!d.total) { setMsg("No other numbers connected — this is the only WABA, so the form already works everywhere it can."); return; }
      const failed = (d.publishedTo ?? []).filter((r: { error?: string }) => r.error);
      setMsg(`Published to ${d.count}/${d.total} other number${d.total !== 1 ? "s" : ""}.`
        + (failed.length ? ` Failed: ${failed.map((r: { channel: string; error: string }) => `${r.channel} — ${r.error}`).join(" · ")}` : " Flows can now send this form natively from any number."));
      load();
    } finally { setBusy(null); }
  }

  async function remove(f: WaFormRow) {
    if (!confirm(`${f.status === "PUBLISHED" ? "Deprecate" : "Delete"} form "${f.name}"?`)) return;
    await fetch("/api/admin/waforms", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, channelId }) });
    load();
  }

  const statusPill = (s: string) =>
    s === "PUBLISHED" ? "bg-brand-100 text-brand-700" : s === "DRAFT" ? "bg-amber-100 text-amber-700"
    : s === "DEPRECATED" ? "bg-canvas text-ink-400" : "bg-red-100 text-red-600";

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-4xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">WhatsApp Forms</h2>
          <p className="text-[13px] text-ink-400">Native forms that open inside WhatsApp — collect name, email, choices and dates without the customer leaving the chat. Answers save to contact attributes automatically.</p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <ChannelSelect value={channelId} onChange={setChannelId} allLabel="Number: default" className={`${inp} !py-2 text-xs`} />
          <button onClick={load} disabled={refreshing} className="px-4 py-2 rounded-control border border-brand-700 text-brand-700 text-[13px] font-semibold flex items-center gap-2 disabled:opacity-60 hover:bg-brand-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Sync
          </button>
          <button onClick={() => { resetBuilder(); setShowBuilder(v => !v); }} className={btnPrimary}>
            {showBuilder ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showBuilder ? "Close" : "New form"}
          </button>
        </div>
      </div>

      <FormResponsesPanel />

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-control px-4 py-3 text-sm text-amber-800">{notice}</div>}
      {msg && <div className="bg-brand-50 border border-brand-100 rounded-control px-4 py-3 text-sm text-brand-900">{msg}</div>}

      {showBuilder && (
        <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
          <section className="bg-white rounded-card border border-line p-5 space-y-4">
            <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">{editingId ? "Edit form" : cloneNote ? "Edit a copy" : "New form"}</p>
            {cloneNote && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">Editing a copy of <b>{cloneNote}</b>. Published forms can&apos;t be changed on WhatsApp, so this saves as a <b>new</b> form.</p>}
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Form name (internal)" value={name} onChange={e => setName(e.target.value)} />
              <input className={inp} maxLength={30} placeholder="Title shown on the form (30 chars)" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">Fields</p>
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className={`${inp} w-32 shrink-0`} value={f.type} onChange={e => setField(i, { type: e.target.value as UiFormFieldType })}>
                    {FORM_FIELD_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                  <input className={`${inp} flex-1`} maxLength={f.type === "optin" ? 120 : 30} placeholder={f.type === "optin" ? "Opt-in text, e.g. Send me updates on WhatsApp" : "Field label, e.g. Which course?"} value={f.label} onChange={e => setField(i, { label: e.target.value })} />
                  {isChoice(f.type) && <input className={`${inp} flex-1`} placeholder="Options, comma-separated" value={f.options} onChange={e => setField(i, { options: e.target.value })} />}
                  <label className="flex items-center gap-1 text-[11px] text-ink-400 shrink-0 cursor-pointer">
                    <input type="checkbox" className="accent-brand-700" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} /> req
                  </label>
                  <button onClick={() => setFields(fs => fs.filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ))}
              {fields.length < 15 && (
                <button onClick={() => setFields(fs => [...fs, { type: "text", label: "", required: false, options: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Add field
                </button>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => (editingId ? update(true) : create(true))} disabled={!!busy} className={btnPrimary}>
                {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {editingId ? "Update & publish" : "Create & publish"}
              </button>
              <button onClick={() => (editingId ? update(false) : create(false))} disabled={!!busy} className="px-4 py-2 rounded-control border border-line text-ink-600 text-[13px] font-semibold flex items-center gap-2 hover:bg-canvas disabled:opacity-60">
                {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {editingId ? "Save draft" : "Save as draft"}
              </button>
            </div>
            <p className="text-[11px] text-ink-400">Forms publish instantly (Meta validates — no review queue). Answers land on the contact as attributes named after each field.</p>
          </section>

          {/* Phone-style preview */}
          <div className="bg-[#e5ddd5] rounded-card p-4 sticky top-4">
            <p className="text-[10px] font-bold text-ink-600 uppercase mb-2">Preview</p>
            <div className="bg-white rounded-xl overflow-hidden shadow-sm">
              <div className="bg-brand-700 text-white text-[12px] font-semibold px-3 py-2">{title.trim() || name.trim() || "Form"}</div>
              <div className="p-3 space-y-2.5">
                {fields.filter(f => f.label.trim()).map((f, i) => (
                  <div key={i}>
                    <p className="text-[10px] font-semibold text-ink-600 mb-0.5">{f.label}{f.required && <span className="text-red-500"> *</span>}</p>
                    {isChoice(f.type)
                      ? <div className="space-y-1">{f.options.split(",").map(s => s.trim()).filter(Boolean).slice(0, 4).map(o => (
                          <div key={o} className="flex items-center gap-1.5 text-[10px] text-ink-400">
                            <span className={`inline-block w-3 h-3 border border-line ${f.type === "checkbox" ? "rounded" : "rounded-full"}`} />{o}
                          </div>
                        ))}</div>
                      : f.type === "optin"
                        ? <div className="flex items-center gap-1.5 text-[10px] text-ink-400"><span className="inline-block w-3 h-3 border border-line rounded" />{f.label}</div>
                        : <div className="border border-line rounded-lg px-2 py-1.5 text-[10px] text-ink-400">{f.type === "date" ? "📅 Select date" : f.type === "textarea" ? "Type here…" : `Enter ${f.type}`}</div>}
                  </div>
                ))}
                {!fields.some(f => f.label.trim()) && <p className="text-[10px] text-ink-400 text-center py-4">Add fields to see them here</p>}
                <button className="w-full py-1.5 rounded-full bg-brand-700 text-white text-[11px] font-bold">Submit</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-card border border-line divide-y divide-line">
        {forms.map(f => (
          <div key={f.id} className="px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-control bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><ClipboardList className="w-[18px] h-[18px]" /></div>
            <div className="min-w-0 flex-1">
              <button onClick={() => renameForm(f)} disabled={busy === "rename:" + f.id} title="Click to rename" className="text-sm font-semibold text-ink-900 truncate text-left hover:underline disabled:opacity-60">{f.name}</button>
              {f.validationErrors.length > 0 && <p className="text-[11px] text-red-500 truncate">Fix before publishing: {f.validationErrors.join(" · ")}</p>}
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${statusPill(f.status)}`}>{f.status}</span>
            {f.previewUrl && (
              <a href={f.previewUrl} target="_blank" rel="noreferrer" title="Open Meta's interactive preview"
                className="p-1.5 text-ink-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg shrink-0"><ExternalLink className="w-4 h-4" /></a>
            )}
            {f.status !== "DEPRECATED" && (
              <button onClick={() => openEdit(f)} disabled={busy === "load:" + f.id}
                className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 disabled:opacity-60">
                {busy === "load:" + f.id ? "…" : f.status === "PUBLISHED" ? "Edit a copy" : "Edit"}
              </button>
            )}
            {f.status === "DRAFT" && f.validationErrors.length === 0 && (
              <button onClick={() => publish(f.id)} disabled={busy === f.id}
                className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold shrink-0 disabled:opacity-60">
                {busy === f.id ? "…" : "Publish"}
              </button>
            )}
            {f.status === "PUBLISHED" && (
              <button onClick={() => publishAll(f)} disabled={busy === "all:" + f.id}
                title="Publish an identical copy of this form to every other connected number's WABA, so a chatbot flow can send it natively from any number"
                className="px-3 py-1.5 rounded-control border border-brand-700 text-brand-700 text-xs font-bold hover:bg-brand-50 shrink-0 disabled:opacity-60">
                {busy === "all:" + f.id ? "…" : "Publish to all numbers"}
              </button>
            )}
            <button onClick={() => remove(f)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {forms.length === 0 && <p className="px-4 py-8 text-center text-ink-400 text-sm">{notice ? "Forms appear here once Meta credentials are set." : "No forms yet — hit New form to build your first one."}</p>}
      </div>

      <p className="text-[11px] text-ink-400">To send a form in a chatbot: open <b>Chatbot Flows</b> → drag the <b>WhatsApp form</b> block → pick a published form. The flow waits for the submission and then continues.</p>
    </div>
    <FormsRail goTo={goTo} forms={forms} />
    </div>
  );
}

export default FormsTab;
