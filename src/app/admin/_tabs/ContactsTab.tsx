"use client";

// Contacts: table + filters + CSV import/export, with the shared ContactProfile
// drawer. Extracted from admin/page.tsx, lazy-loaded. Pure relocation.
import { useState, useEffect, useCallback } from "react";
type AudienceBatch = { id: string; name: string; description: string | null; kind: "static" | "dynamic"; size: number; archivedAt: string | null };
type BatchDetail = {
  batch: AudienceBatch; size: number; noConsent: number | null; marketingReach: number | null;
  members: { id: string; name: string; phone: string; optedIn: boolean; optInAt: string | null; addedAt: string | null }[];
  memberTotal: number; offset: number; limit: number;
};
import { mapCsvRows, readTable, type ImportRow } from "@/lib/csv-import";
import { Filter, Send, Plus, UploadCloud, Download, X, Loader2, Check, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { inp, type Tab, useChannelList } from "../_shared";
import { ContactProfile } from "./ContactProfile";

type ContactRow = { id: string; phone: string; name: string; email: string | null; tags: string[]; status: string; source: string | null; channelId?: string | null; createdAt: string };

// ── Advanced filters ──
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
  const [csvPreview, setCsvPreview] = useState<{ fileName: string; cells: string[][]; rows: ImportRow[]; mapping: string[]; skipped: number } | null>(null);
  // Exports usually carry bare national numbers, which this API rejects as
  // invalid E.164 — so the country code has to be applied, and visibly.
  const [defaultCc, setDefaultCc] = useState("91");
  const [skipBlocked, setSkipBlocked] = useState(true);
  // Batches: named broadcast audiences (migration 0112).
  const [batches, setBatches] = useState<AudienceBatch[]>([]);
  const [showBatches, setShowBatches] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [newBatchKind, setNewBatchKind] = useState<"static" | "dynamic">("static");
  const [consentStats, setConsentStats] = useState<{ granted: number; missing: number } | null>(null);
  const [openBatch, setOpenBatch] = useState<BatchDetail | null>(null);
  const [batchOffset, setBatchOffset] = useState(0);
  const [addQuery, setAddQuery] = useState("");
  const [addHits, setAddHits] = useState<{ id: string; name: string; phone: string }[]>([]);
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

  async function importRows(rows: ImportRow[], consent = true, batchId?: string) {
    setImporting(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: rows, consent, ...(batchId ? { batchId } : {}) }) });
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

  const loadBatches = useCallback(() => {
    fetch("/api/admin/batches").then(r => r.json()).then(d => {
      setBatches(d.batches ?? []); setConsentStats(d.consent ?? null);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  // Re-derive the preview when the country code changes, so what is shown is
  // always what would be stored.
  useEffect(() => {
    setCsvPreview(p => {
      if (!p) return p;
      const { rows, mapping } = mapCsvRows(p.cells, defaultCc);
      return { ...p, rows, mapping };
    });
  }, [defaultCc]);

  const openBatchDetail = useCallback(async (id: string, offset = 0) => {
    const d = await fetch(`/api/admin/batches/${id}?offset=${offset}&limit=50`).then(r => r.json()).catch(() => null);
    if (d?.batch) { setOpenBatch(d); setBatchOffset(offset); } else setMsg("Could not load that batch.");
  }, []);

  useEffect(() => {
    const q = addQuery.trim();
    if (!openBatch || q.length < 2) { setAddHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/admin/contacts?search=${encodeURIComponent(q)}&limit=8`)
        .then(r => r.json()).then(d => setAddHits(d.contacts ?? [])).catch(() => setAddHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [addQuery, openBatch]);

  async function batchAction(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/batches/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "That didn't work."); return null; }
    await openBatchDetail(id, batchOffset);
    loadBatches();
    return d;
  }

  async function createBatchNow() {
    const name = newBatchName.trim();
    if (!name) { setMsg("Give the batch a name."); return; }
    const res = await fetch("/api/admin/batches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind: newBatchKind }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg(d.error || "Could not create the batch"); return; }
    setNewBatchName(""); setMsg(`Batch "${name}" created.`); loadBatches();
  }

  async function addSelectedToBatch(id: string) {
    if (!selected.size) return;
    const d = await batchAction(id, { action: "addMembers", contactIds: [...selected] });
    if (d) {
      setMsg(`Added ${d.added} of ${d.requested} to the batch${d.added < d.requested ? " (the rest were already in it)" : ""}.`);
      setSelected(new Set());
    }
  }

  // Create the batch if new, otherwise reuse the existing one — a 409 means
  // "already exists", which for an import is success, not failure.
  async function ensureBatch(name: string): Promise<string | null> {
    const res = await fetch("/api/admin/batches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind: "static" }),
    });
    if (res.ok) return (await res.json()).batch?.id ?? null;
    const list = await fetch("/api/admin/batches").then(r => r.json()).catch(() => ({ batches: [] }));
    return (list.batches ?? []).find((b: AudienceBatch) => b.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  }

  // A file with a "Batch Name" column can span several batches, so import it in
  // one group per batch rather than forcing one batch on the whole file.
  async function importWithBatches(all: ImportRow[], consent: boolean) {
    const usable = skipBlocked ? all.filter(r => !r.blocked) : all;
    const heldBack = all.length - usable.length;
    if (!usable.length) { setMsg("Every row in this file is marked blocked — nothing to import."); return false; }

    const named = usable.filter(r => r.batchName);
    if (!named.length) return importRows(usable, consent);

    const groups = new Map<string, ImportRow[]>();
    for (const r of usable) groups.set(r.batchName ?? "", [...(groups.get(r.batchName ?? "") ?? []), r]);
    const notes: string[] = [];
    let allOk = true;
    for (const [name, group] of groups) {
      const id = name ? await ensureBatch(name) : null;
      allOk = (await importRows(group, consent, id ?? undefined)) && allOk;
      notes.push(`${name || "no batch"}: ${group.length}`);
    }
    setMsg(`Imported ${usable.length} across ${groups.size} batch(es) — ${notes.join(", ")}.`
      + (heldBack ? ` ${heldBack} blocked row(s) skipped.` : ""));
    loadBatches();
    return allOk;
  }

  // CSV file picked — parse, auto-map columns, show the preview for confirmation.
  async function onCsvFile(f: File) {
    setMsg(null);
    try {
      const cells = await readTable(f);
      const { rows, mapping } = mapCsvRows(cells, defaultCc);
      const dataCount = Math.max(0, cells.length - (rows.length === cells.length ? 0 : 1));
      if (!rows.length) { setMsg("No rows with a valid phone number found in this file."); setCsvPreview(null); return; }
      setCsvPreview({ fileName: f.name, cells, rows, mapping, skipped: Math.max(0, dataCount - rows.length) });
    } catch (err) {
      // readTable explains .xls and non-zip cases specifically — keep that
      // rather than replacing it with a generic "not a CSV".
      setMsg(err instanceof Error ? err.message : "Could not read that file.");
      setCsvPreview(null);
    }
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
        <select
          className={`${toolbarBtn} ${selected.size ? "border-brand-dark text-brand-dark" : ""}`}
          disabled={selected.size === 0} value=""
          onChange={e => { if (e.target.value) addSelectedToBatch(e.target.value); }}
          title={selected.size ? "Add the selected contacts to a batch" : "Select contacts first"}>
          <option value="">{selected.size ? `Add ${selected.size} to batch…` : "Add to batch"}</option>
          {batches.filter(b => b.kind === "static").map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button onClick={() => setShowBatches(v => !v)} className={`${toolbarBtn} ${showBatches ? "border-brand-dark text-brand-dark" : ""}`}>
          <Users className="w-4 h-4" /> Batches{batches.length ? ` (${batches.length})` : ""}
        </button>
        <button onClick={() => { setShowAdd(v => !v); setShowImport(false); }} className={toolbarBtn}><Plus className="w-4 h-4" /> Add Contact</button>
        <button onClick={() => { setShowImport(v => !v); setShowAdd(false); }} className={toolbarBtn}><UploadCloud className="w-4 h-4" /> Import</button>
        <button onClick={exportCsv} className={toolbarBtn} title="Export selected (or current view) as CSV"><Download className="w-4 h-4" /> Export</button>
      </div>

      {showBatches && (
        <div className="bg-white rounded-card border border-line p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold text-brand-dark">Batches</p>
              <p className="text-xs text-slate-500 mt-0.5">
                A named audience you can pick in Broadcast. <b>Static</b> holds the exact people you add —
                so you can always see who a past broadcast went to. <b>Dynamic</b> re-runs a filter at send time.
              </p>
            </div>
            {consentStats && (
              /* Opt-in is enforced upstream: every broadcast resolves its
                 audience with onlyOptedIn, so unconsented contacts are never
                 queued. This shows how much of the base that leaves. */
              <div className="text-xs text-slate-600 bg-slate-50 border border-line rounded-lg px-3 py-2 space-y-0.5">
                <p><b className="text-brand-dark">{consentStats.granted.toLocaleString()}</b> opted in</p>
                {consentStats.missing > 0 && <p className="text-amber-700"><b>{consentStats.missing.toLocaleString()}</b> not — excluded from broadcasts</p>}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <input className={`${inp} w-64`} placeholder="New batch name (e.g. Aug weekend batch)"
              value={newBatchName} onChange={e => setNewBatchName(e.target.value)} />
            <select className={inp} value={newBatchKind} onChange={e => setNewBatchKind(e.target.value as "static" | "dynamic")}>
              <option value="static">Static — the people I add</option>
              <option value="dynamic">Dynamic — a live filter</option>
            </select>
            <button onClick={createBatchNow} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">Create</button>
          </div>

          {batches.length === 0 ? (
            <p className="text-xs text-slate-400">No batches yet. Create one, then tick contacts in the table and use <b>Add to batch</b>.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left text-xs">
                  <tr><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Contacts</th><th className="px-3 py-2"></th></tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <button onClick={() => openBatchDetail(b.id)} className="font-semibold text-brand-dark hover:underline text-left">{b.name}</button>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{b.kind === "dynamic" ? "Live filter" : "Static"}</td>
                      <td className="px-3 py-2">{b.size.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openBatchDetail(b.id)} className="text-xs font-bold text-brand-700 hover:underline mr-3">View</button>
                        <button onClick={async () => {
                          if (openBatch?.batch.id === b.id) setOpenBatch(null);
                          const res = await fetch(`/api/admin/batches/${b.id}`, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "archive" }),
                          });
                          setMsg(res.ok ? `Archived "${b.name}".` : "Could not archive that batch");
                          if (res.ok) loadBatches();
                        }} className="text-xs font-bold text-slate-400 hover:text-red-600">Archive</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {openBatch && (() => {
            const d = openBatch;
            const isStatic = d.batch.kind === "static";
            const from = d.memberTotal === 0 ? 0 : d.offset + 1;
            const to = Math.min(d.offset + d.limit, d.memberTotal);
            return (
              <div className="border-t border-line pt-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-bold text-brand-dark">{d.batch.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {isStatic ? "Static" : "Dynamic (live filter)"} · {d.size.toLocaleString()} contact{d.size === 1 ? "" : "s"}
                      {d.noConsent !== null && d.noConsent > 0 && <> · <span className="text-amber-700">{d.noConsent.toLocaleString()} not opted in</span></>}
                      {d.marketingReach !== null && <> · will reach <b>{d.marketingReach.toLocaleString()}</b></>}
                    </p>
                  </div>
                  <button onClick={() => { setOpenBatch(null); setAddQuery(""); }} className="text-xs font-bold text-slate-400 hover:text-slate-600">Close</button>
                </div>

                {isStatic ? (
                  <div className="space-y-1.5">
                    <input className={`${inp} w-full`} placeholder="Add someone — search name or number (min 2 characters)"
                      value={addQuery} onChange={e => setAddQuery(e.target.value)} />
                    {addHits.length > 0 && (
                      <div className="border border-line rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                        {addHits.map(c => {
                          const already = d.members.some(m => m.id === c.id);
                          return (
                            <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-brand-dark truncate">{c.name || "(no name)"}</p>
                                <p className="text-[11px] text-slate-400 font-mono">{c.phone}</p>
                              </div>
                              <button disabled={already}
                                onClick={async () => {
                                  const r = await batchAction(d.batch.id, { action: "addMembers", contactIds: [c.id] });
                                  if (r) { setMsg(r.added ? `Added ${c.name || c.phone}.` : `${c.name || c.phone} was already in this batch.`); setAddQuery(""); }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-brand-700 text-white text-[11px] font-bold disabled:opacity-40 shrink-0">
                                {already ? "In batch" : "Add"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {addQuery.trim().length >= 2 && addHits.length === 0 && (
                      <p className="text-[11px] text-slate-400">No contact matches that. Import them first, then add.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 bg-slate-50 border border-line rounded-lg px-3 py-2">
                    This batch is a live filter, so its people can&apos;t be added or removed one by one — change the filter instead.
                  </p>
                )}

                {d.members.length === 0 ? (
                  <p className="text-xs text-slate-400">No one in this batch yet.{isStatic ? " Search above, or tick contacts in the table and use Add to batch." : ""}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-left text-xs">
                        <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Opt-in</th>{isStatic && <th className="px-3 py-2"></th>}</tr>
                      </thead>
                      <tbody>
                        {d.members.map(m => (
                          <tr key={m.id} className="border-t border-line">
                            <td className="px-3 py-2">{m.name || "(no name)"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{m.phone}</td>
                            <td className="px-3 py-2 text-xs">
                              {m.optedIn ? <span className="text-brand-700">● opted in</span>
                                         : <span className="text-amber-700">● not opted in — excluded</span>}
                            </td>
                            {isStatic && (
                              <td className="px-3 py-2 text-right">
                                <button onClick={async () => {
                                  const r = await batchAction(d.batch.id, { action: "removeMembers", contactIds: [m.id] });
                                  if (r) setMsg(`Removed ${m.name || m.phone} from ${d.batch.name}.`);
                                }} className="text-xs font-bold text-slate-400 hover:text-red-600">Remove</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {d.memberTotal > d.limit && (
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{from.toLocaleString()}–{to.toLocaleString()} of {d.memberTotal.toLocaleString()}</span>
                    <span className="flex gap-2">
                      <button disabled={d.offset === 0} onClick={() => openBatchDetail(d.batch.id, Math.max(0, d.offset - d.limit))}
                        className="font-bold text-brand-700 disabled:opacity-30">← Prev</button>
                      <button disabled={to >= d.memberTotal} onClick={() => openBatchDetail(d.batch.id, d.offset + d.limit)}
                        className="font-bold text-brand-700 disabled:opacity-30">Next →</button>
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

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
                <span className="text-sm font-semibold text-slate-500">Drop an Excel or CSV file here, or click to browse</span>
                <span className="text-[11px] text-slate-400">.xlsx, .csv, .tsv — we auto-detect the phone, name, email and batch columns; every other column becomes a contact attribute</span>
                <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onCsvFile(f); e.target.value = ""; }} />
              </label>
              <p className="text-[11px] text-slate-400">Duplicates (by phone) are skipped. Tags inside a cell can be separated by <code className="bg-slate-100 px-1 rounded">;</code></p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-brand-dark">{csvPreview.fileName} — {csvPreview.rows.length.toLocaleString()} contacts ready{csvPreview.skipped > 0 ? `, ${csvPreview.skipped} rows skipped (no valid phone)` : ""}</p>
                {(() => {
                  const found = [...new Set(csvPreview.rows.map(r => r.batchName).filter(Boolean))] as string[];
                  const blocked = csvPreview.rows.filter(r => r.blocked).length;
                  return (
                    <div className="space-y-1">
                      {found.length > 0 && (
                        <p className="text-[12px] text-brand-700">
                          Batch column detected — these will be created and filled automatically: <b>{found.join(", ")}</b>
                        </p>
                      )}
                      {blocked > 0 && (
                        <label className="flex items-center gap-2 text-[12px] text-amber-700">
                          <input type="checkbox" checked={skipBlocked} onChange={e => setSkipBlocked(e.target.checked)} />
                          Skip the <b>{blocked}</b> row(s) this file marks blocked
                        </label>
                      )}
                      <div className="flex items-center gap-2 text-[12px] text-slate-600">
                        <span>Country code for numbers without one</span>
                        <input value={defaultCc} onChange={e => setDefaultCc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                          className="w-16 px-2 py-1 rounded-lg border border-line text-[12px]" />
                        <span className="text-slate-400">a bare 10-digit number is rejected as invalid without it</span>
                      </div>
                    </div>
                  );
                })()}
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
              <button onClick={() => importWithBatches(csvPreview.rows, importConsent)} disabled={importing} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
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
