"use client";

// Contacts: table + filters + CSV import/export, with the shared ContactProfile
// drawer. Extracted from admin/page.tsx, lazy-loaded. Pure relocation.
import { useState, useEffect, useCallback } from "react";
import { Filter, Send, Plus, UploadCloud, Download, X, Loader2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { inp, type Tab, useChannelList } from "../_shared";
import { ContactProfile } from "./ContactProfile";

type ContactRow = { id: string; phone: string; name: string; email: string | null; tags: string[]; status: string; source: string | null; channelId?: string | null; createdAt: string };

// ── Advanced filters (AiSensy-style) ──
type AttrFilter = { key: string; op: "is" | "is_not" | "contains"; value: string };
type AdvFilters = { seenFrom: string; seenTo: string; createdFrom: string; createdTo: string; source: string; attrs: AttrFilter[] };
const EMPTY_ADV: AdvFilters = { seenFrom: "", seenTo: "", createdFrom: "", createdTo: "", source: "", attrs: [] };
const advActive = (a: AdvFilters) => !!(a.seenFrom || a.seenTo || a.createdFrom || a.createdTo || a.source || a.attrs.some(x => x.key.trim()));
// Every value the code writes to contacts.source — where the lead came from.
const LEAD_SOURCES: [string, string][] = [
  ["inbound", "WhatsApp inbound"], ["chat_form", "Chat form"], ["web_chat", "Web chat"],
  ["instagram", "Instagram"], ["messenger", "Facebook"], ["meta_lead_ad", "Meta lead ad"],
  ["import", "CSV import"], ["crm", "CRM"],
];

// ── CSV upload + auto column mapping ──
type ImportRow = { phone: string; name?: string; email?: string; tags?: string[]; attributes?: Record<string, string> };

// Minimal CSV parser — handles quoted fields and CRLF.
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const CSV_COL: Record<string, string[]> = {
  phone: ["phone", "mobile", "mobile number", "mobile_no", "whatsapp", "whatsapp number", "number", "contact", "contact number", "phone number", "msisdn"],
  name: ["name", "full name", "fullname", "first name", "contact name", "customer name", "lead name"],
  email: ["email", "e-mail", "email id", "email address"],
  tags: ["tags", "tag", "labels", "label", "groups", "segment"],
};
const looksLikePhone = (s: string) => /^\+?\d[\d\s()-]{7,}$/.test(s.trim());

// Auto-detects the header row and maps columns: known headers → fields, every
// other headed column → a contact attribute. Headerless files fall back to
// positional phone,name,tags.
function mapCsvRows(cells: string[][]): { rows: ImportRow[]; mapping: string[] } {
  if (!cells.length) return { rows: [], mapping: [] };
  const head = cells[0].map(c => c.trim().toLowerCase());
  const find = (names: string[]) => head.findIndex(h => names.includes(h));
  let pi = find(CSV_COL.phone);
  let ni = find(CSV_COL.name);
  const ei = find(CSV_COL.email);
  let ti = find(CSV_COL.tags);
  const hasHeader = pi >= 0 || ni >= 0 || ei >= 0 || ti >= 0 || !looksLikePhone(cells[0][0] ?? "");
  if (pi < 0) pi = 0;
  if (!hasHeader) { if (ni < 0) ni = 1; if (ti < 0) ti = 2; }

  const attrCols: { idx: number; key: string }[] = [];
  if (hasHeader) {
    cells[0].forEach((h, idx) => {
      if (idx !== pi && idx !== ni && idx !== ei && idx !== ti && h.trim()) attrCols.push({ idx, key: h.trim() });
    });
  }
  const dataRows = hasHeader ? cells.slice(1) : cells;
  const rows: ImportRow[] = dataRows.map(r => {
    const attributes: Record<string, string> = {};
    for (const a of attrCols) { const v = (r[a.idx] ?? "").trim(); if (v) attributes[a.key] = v; }
    return {
      phone: (r[pi] ?? "").trim(),
      name: ni >= 0 ? (r[ni] ?? "").trim() : "",
      email: ei >= 0 ? ((r[ei] ?? "").trim() || undefined) : undefined,
      tags: ti >= 0 ? (r[ti] ?? "").split(/[;|]/).map(t => t.trim()).filter(Boolean) : [],
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
  }).filter(r => looksLikePhone(r.phone));
  const mapping = [
    `phone ← ${hasHeader ? `"${cells[0][pi]?.trim() || "column 1"}"` : "column 1"}`,
    ni >= 0 ? `name ← ${hasHeader ? `"${cells[0][ni]?.trim()}"` : "column 2"}` : null,
    ei >= 0 ? `email ← "${cells[0][ei]?.trim()}"` : null,
    ti >= 0 ? `tags ← ${hasHeader ? `"${cells[0][ti]?.trim()}"` : "column 3"}` : null,
    ...attrCols.map(a => `attribute "${a.key}"`),
  ].filter(Boolean) as string[];
  return { rows, mapping };
}

function ContactsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  // "Via" column: which number/account produced the lead (first touch, 0073).
  const contactChannels = useChannelList();
  const contactChannelName = (cid?: string | null) => contactChannels.find(ch => ch.id === cid)?.name ?? null;
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "optedout">("all");
  const [showFilter, setShowFilter] = useState(false);
  const [offset, setOffset] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [addName, setAddName] = useState("");
  const [addTags, setAddTags] = useState("");
  const [csvPreview, setCsvPreview] = useState<{ fileName: string; rows: ImportRow[]; mapping: string[]; skipped: number } | null>(null);
  const [adv, setAdv] = useState<AdvFilters>(EMPTY_ADV);          // draft (being edited)
  const [applied, setApplied] = useState<AdvFilters>(EMPTY_ADV);  // active (drives the query)
  const [importing, setImporting] = useState(false);
  const [importConsent, setImportConsent] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ sentToday: number } | null>(null);

  const dailyLimit = parseInt(process.env.NEXT_PUBLIC_WA_DAILY_LIMIT ?? "900", 10);

  const load = useCallback(() => {
    const params = new URLSearchParams({ search, offset: String(offset), limit: String(perPage) });
    if (tagFilter.trim()) params.set("tag", tagFilter.trim());
    if (applied.createdFrom) params.set("createdFrom", applied.createdFrom);
    if (applied.createdTo) params.set("createdTo", applied.createdTo);
    if (applied.seenFrom) params.set("seenFrom", applied.seenFrom);
    if (applied.seenTo) params.set("seenTo", applied.seenTo);
    if (applied.source) params.set("source", applied.source);
    const attrs = applied.attrs.filter(a => a.key.trim());
    if (attrs.length) params.set("attrs", JSON.stringify(attrs));
    fetch(`/api/admin/contacts?${params}`).then(r => r.json()).then(d => { setContacts(d.contacts ?? []); setTotal(d.total ?? 0); }).catch(() => {});
  }, [search, tagFilter, offset, perPage, applied]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); setSelected(new Set()); }, [search, tagFilter, perPage, applied]);
  useEffect(() => {
    fetch("/api/admin/analytics").then(r => r.json()).then(d => { if (d?.messaging) setQuota({ sentToday: d.messaging.sentToday ?? 0 }); }).catch(() => {});
  }, []);

  const visible = statusFilter === "all" ? contacts : contacts.filter(c => c.status === statusFilter);
  const allChecked = visible.length > 0 && visible.every(c => selected.has(c.id));

  const toggleAll = () => setSelected(s => {
    const next = new Set(s);
    if (allChecked) visible.forEach(c => next.delete(c.id)); else visible.forEach(c => next.add(c.id));
    return next;
  });
  const toggleOne = (id: string) => setSelected(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  function broadcastSelected() {
    const recipients = contacts.filter(c => selected.has(c.id) && c.status === "active").map(c => ({ phone: c.phone, fullName: c.name }));
    if (!recipients.length) { setMsg("Select at least one active contact."); return; }
    sessionStorage.setItem("wa_retarget", JSON.stringify({ note: `Selected contacts (${recipients.length})`, recipients }));
    goTo("broadcast");
  }

  function exportCsv() {
    const rows = selected.size ? contacts.filter(c => selected.has(c.id)) : visible;
    const body = ["phone,name,email,tags,status,source", ...rows.map(c =>
      [c.phone, `"${(c.name || "").replaceAll('"', '""')}"`, c.email ?? "", `"${c.tags.join(";")}"`, c.status, c.source ?? ""].join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "contacts.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  async function importRows(rows: ImportRow[], consent = true) {
    setImporting(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: rows, consent }) });
      const d = await res.json();
      setMsg(res.ok
        ? `Imported ${d.inserted}, skipped ${d.skipped} (duplicates)${d.invalid ? `, ${d.invalid} invalid number${d.invalid === 1 ? "" : "s"}` : ""}.${consent ? "" : " Marked not-opted-in — excluded from broadcasts until they opt in."}`
        : (d.error || "Import failed"));
      if (res.ok) { setCsvPreview(null); setAddPhone(""); setAddName(""); setAddTags(""); load(); }
      return res.ok;
    } finally { setImporting(false); }
  }

  async function addContact() {
    if (!addPhone.trim()) { setMsg("Phone is required."); return; }
    const ok = await importRows([{ phone: addPhone.trim(), name: addName.trim(), tags: addTags.split(/[;,]/).map(t => t.trim()).filter(Boolean) }], true);
    if (ok) setShowAdd(false);
  }

  // CSV file picked — parse, auto-map columns, show the preview for confirmation.
  async function onCsvFile(f: File) {
    setMsg(null);
    try {
      const cells = parseCsvText(await f.text());
      const { rows, mapping } = mapCsvRows(cells);
      const dataCount = Math.max(0, cells.length - (rows.length === cells.length ? 0 : 1));
      if (!rows.length) { setMsg("No rows with a valid phone number found in this file."); setCsvPreview(null); return; }
      setCsvPreview({ fileName: f.name, rows, mapping, skipped: Math.max(0, dataCount - rows.length) });
    } catch { setMsg("Could not read that file — make sure it's a CSV."); }
  }

  // Quick-range helpers for the filter chips.
  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const isoStartOf = (unit: "day" | "week" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (unit === "month") d.setDate(1);
    return d.toISOString();
  };
  const setAdvField = (patch: Partial<AdvFilters>) => setAdv(a => ({ ...a, ...patch }));
  const setAttr = (i: number, patch: Partial<AttrFilter>) => setAdv(a => ({ ...a, attrs: a.attrs.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const page = Math.floor(offset / perPage) + 1;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const toolbarBtn = "px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5";

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-extrabold text-brand-dark">Contacts <span className="text-sm font-normal text-slate-400">({total.toLocaleString()})</span></h2>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Daily quota <span className="ml-1 px-2 py-0.5 rounded-full bg-brand-green/15 text-brand-dark font-bold">{dailyLimit.toLocaleString()}/24h</span></span>
          {quota && <span>Remaining today <b className="text-brand-dark">{Math.max(0, dailyLimit - quota.sentToday).toLocaleString()}</b></span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${inp} w-64`} placeholder="Search name or mobile number" value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={() => setShowFilter(v => !v)} className={`${toolbarBtn} ${showFilter || tagFilter || statusFilter !== "all" || advActive(applied) ? "border-brand-dark text-brand-dark" : ""}`}>
          <Filter className="w-4 h-4" /> Filter{advActive(applied) ? " ·" : ""}
        </button>
        <div className="flex-1" />
        <button onClick={broadcastSelected} disabled={selected.size === 0}
          className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-40">
          <Send className="w-4 h-4" /> BROADCAST{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
        <button onClick={() => { setShowAdd(v => !v); setShowImport(false); }} className={toolbarBtn}><Plus className="w-4 h-4" /> Add Contact</button>
        <button onClick={() => { setShowImport(v => !v); setShowAdd(false); }} className={toolbarBtn}><UploadCloud className="w-4 h-4" /> Import</button>
        <button onClick={exportCsv} className={toolbarBtn} title="Export selected (or current view) as CSV"><Download className="w-4 h-4" /> Export</button>
      </div>

      {showFilter && (() => {
        const chip = "px-2.5 py-1.5 rounded-lg border border-line text-xs font-semibold text-slate-500 hover:bg-slate-50";
        const dateVal = (s: string) => (s ? s.slice(0, 10) : "");
        const endOfDay = (d: string) => (d ? `${d}T23:59:59` : "");
        return (
          <div className="bg-white rounded-card border border-line p-5 space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-2">
                Last Seen
                {(adv.seenFrom || adv.seenTo) && <button onClick={() => setAdvField({ seenFrom: "", seenTo: "" })} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button className={chip} onClick={() => setAdvField({ seenFrom: isoDaysAgo(1), seenTo: "" })}>In 24hr</button>
                <button className={chip} onClick={() => setAdvField({ seenFrom: isoStartOf("week"), seenTo: "" })}>This Week</button>
                <button className={chip} onClick={() => setAdvField({ seenFrom: isoStartOf("month"), seenTo: "" })}>This Month</button>
                <input type="date" className={inp} value={dateVal(adv.seenFrom)} onChange={e => setAdvField({ seenFrom: e.target.value })} />
                <input type="date" className={inp} value={dateVal(adv.seenTo)} onChange={e => setAdvField({ seenTo: endOfDay(e.target.value) })} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-2">
                Lead Source
                {adv.source && <button onClick={() => setAdvField({ source: "" })} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {LEAD_SOURCES.map(([v, label]) => (
                  <button key={v} onClick={() => setAdvField({ source: adv.source === v ? "" : v })}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${adv.source === v ? "border-brand-dark text-brand-dark bg-brand-50" : "border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-2">
                Created At
                {(adv.createdFrom || adv.createdTo) && <button onClick={() => setAdvField({ createdFrom: "", createdTo: "" })} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button className={chip} onClick={() => setAdvField({ createdFrom: isoStartOf("day"), createdTo: "" })}>Today</button>
                <button className={chip} onClick={() => setAdvField({ createdFrom: isoStartOf("week"), createdTo: "" })}>This Week</button>
                <button className={chip} onClick={() => setAdvField({ createdFrom: isoStartOf("month"), createdTo: "" })}>This Month</button>
                <input type="date" className={inp} value={dateVal(adv.createdFrom)} onChange={e => setAdvField({ createdFrom: e.target.value })} />
                <input type="date" className={inp} value={dateVal(adv.createdTo)} onChange={e => setAdvField({ createdTo: endOfDay(e.target.value) })} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Attributes</p>
              <div className="space-y-2">
                {adv.attrs.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={`${inp} w-44`} placeholder="attribute, e.g. interest" value={a.key} onChange={e => setAttr(i, { key: e.target.value })} />
                    <select className={`${inp} w-28`} value={a.op} onChange={e => setAttr(i, { op: e.target.value as AttrFilter["op"] })}>
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                      <option value="contains">contains</option>
                    </select>
                    <input className={`${inp} flex-1 max-w-xs`} placeholder="value, e.g. Data Analytics" value={a.value} onChange={e => setAttr(i, { value: e.target.value })} />
                    {i < adv.attrs.length - 1 && <span className="text-xs text-slate-400 font-semibold">and</span>}
                    <button onClick={() => setAdv(x => ({ ...x, attrs: x.attrs.filter((_, j) => j !== i) }))} className="p-1 text-slate-300 hover:text-red-500"><X className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => setAdv(x => ({ ...x, attrs: [...x.attrs, { key: "", op: "is", value: "" }] }))} className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Add condition
                </button>
              </div>
            </div>

            <div className="flex items-end gap-3 flex-wrap pt-1 border-t border-slate-100">
              <div className="pt-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Tag</p>
                <input className={inp} placeholder="e.g. leads" value={tagFilter} onChange={e => setTagFilter(e.target.value)} />
              </div>
              <div className="pt-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Status</p>
                <select className={inp} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="optedout">Opted out</option>
                </select>
              </div>
              <div className="flex-1" />
              <button onClick={() => setApplied(adv)} className="px-5 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">Apply</button>
              <button onClick={() => { setAdv(EMPTY_ADV); setApplied(EMPTY_ADV); setTagFilter(""); setStatusFilter("all"); }}
                className="px-3 py-2 text-sm font-semibold text-slate-400 hover:text-red-500">Clear All</button>
            </div>
          </div>
        );
      })()}

      {showAdd && (
        <div className="bg-white rounded-card border border-line p-4 flex items-end gap-2 flex-wrap">
          <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Mobile *</p><input className={inp} placeholder="919876543210" value={addPhone} onChange={e => setAddPhone(e.target.value)} /></div>
          <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Name</p><input className={inp} placeholder="Asha Verma" value={addName} onChange={e => setAddName(e.target.value)} /></div>
          <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Tags</p><input className={inp} placeholder="leads; webinar-june" value={addTags} onChange={e => setAddTags(e.target.value)} /></div>
          <button onClick={addContact} disabled={importing} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
          </button>
        </div>
      )}

      {showImport && (
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase">Bulk import — upload a CSV, columns are mapped automatically</p>
          {!csvPreview ? (
            <>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-card py-8 cursor-pointer hover:border-brand-dark/50 hover:bg-slate-50"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onCsvFile(f); }}>
                <UploadCloud className="w-8 h-8 text-slate-300" />
                <span className="text-sm font-semibold text-slate-500">Drop your CSV here or click to browse</span>
                <span className="text-[11px] text-slate-400">We auto-detect phone, name, email & tags columns — every other column becomes a contact attribute</span>
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onCsvFile(f); e.target.value = ""; }} />
              </label>
              <p className="text-[11px] text-slate-400">Duplicates (by phone) are skipped. Tags inside a cell can be separated by <code className="bg-slate-100 px-1 rounded">;</code></p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-brand-dark">{csvPreview.fileName} — {csvPreview.rows.length.toLocaleString()} contacts ready{csvPreview.skipped > 0 ? `, ${csvPreview.skipped} rows skipped (no valid phone)` : ""}</p>
                <button onClick={() => setCsvPreview(null)} className="p-1.5 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {csvPreview.mapping.map(m => <span key={m} className="px-2 py-0.5 rounded-full bg-brand-green/10 text-brand-dark text-[11px] font-semibold">{m}</span>)}
              </div>
              <div className="border border-slate-100 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-400 text-left"><tr><th className="px-3 py-1.5">Phone</th><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Tags</th><th className="px-3 py-1.5">Attributes</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {csvPreview.rows.slice(0, 3).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono">{r.phone}</td>
                        <td className="px-3 py-1.5">{r.name || "—"}</td>
                        <td className="px-3 py-1.5">{r.tags?.join(", ") || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-400">{r.attributes ? Object.entries(r.attributes).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="mb-3 flex items-start gap-2.5 rounded-lg border border-line bg-canvas p-3 text-xs text-ink-600">
                <input type="checkbox" checked={importConsent} onChange={e => setImportConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700" />
                <span>These contacts <b className="text-brand-dark">opted in</b> to receive WhatsApp messages from us. Required to include them in broadcasts — sending to non-opted-in numbers is the top cause of Meta number bans. Leave unchecked to import them for 1:1 chats only.</span>
              </label>
              <button onClick={() => importRows(csvPreview.rows, importConsent)} disabled={importing} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Import {csvPreview.rows.length.toLocaleString()} contacts
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-xs text-slate-500">{msg}</p>}

      <div className="bg-white rounded-card border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="pl-4 pr-2 py-2.5 w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-brand-dark" /></th>
              <th className="px-3 py-2.5 font-semibold">Name</th>
              <th className="px-3 py-2.5 font-semibold">Mobile Number</th>
              <th className="px-3 py-2.5 font-semibold">Tags</th>
              <th className="px-3 py-2.5 font-semibold">Source</th>
              <th className="px-3 py-2.5 font-semibold" title="Which number/account this lead first came in on">Via</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map(c => (
              <tr key={c.id} className={`hover:bg-slate-50 ${selected.has(c.id) ? "bg-brand-green/5" : ""}`}>
                <td className="pl-4 pr-2 py-2.5"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="accent-brand-dark" /></td>
                <td className="px-3 py-2.5 font-semibold text-brand-dark cursor-pointer hover:underline" onClick={() => setProfilePhone(c.phone)}>{c.name || "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs cursor-pointer" onClick={() => setProfilePhone(c.phone)}>{c.phone}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {c.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-[11px] font-semibold">{t}</span>)}
                    {c.tags.length > 3 && <span className="text-[11px] text-slate-400">+{c.tags.length - 3}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500 uppercase">{c.source ?? "—"}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{contactChannelName(c.channelId) ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.status === "active" ? "bg-brand-green/15 text-brand-dark" : "bg-red-100 text-red-600"}`}>{c.status === "active" ? "Active" : "Opted out"}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">{contacts.length === 0 ? "No contacts yet — Add Contact or Import a list." : "Nothing matches this filter."}</td></tr>}
          </tbody>
        </table>
        {profilePhone && <ContactProfile phone={profilePhone} onClose={() => setProfilePhone(null)} onChanged={load} goTo={goTo} />}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          <span>{total === 0 ? "0" : `${offset + 1}–${Math.min(offset + perPage, total)}`} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-3">
            <select className="border border-slate-300 rounded-lg px-2 py-1 text-xs" value={perPage} onChange={e => setPerPage(Number(e.target.value))}>
              {[25, 50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
            </select>
            <button onClick={() => setOffset(o => Math.max(0, o - perPage))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <span className="font-semibold">{page}/{lastPage}</span>
            <button onClick={() => setOffset(o => o + perPage)} disabled={page >= lastPage} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContactsTab;
