"use client";

// Platform — kill-switches, announcements, and the audit log.
//
// The audit log is the real change here. It used to be the newest 40 rows
// globally, filtered in the browser: you could not ask "what did we do to this
// account?", and a plan-change request vanished from view the moment 40 newer
// rows existed. It's now a filterable, paged query over indexed columns.

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Loader2, ScrollText } from "lucide-react";
import { Panel, Table, Th, Td, Badge, EmptyState, Spinner, SearchInput, ago, useDebounced } from "../_ui";

type Flag = { key: string; enabled: boolean; description: string | null };
type Entry = { id: string; actorEmail: string; action: string; tenantId: string | null; detail: string; at: string };

const PAGE = 50;

export default function PlatformPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-extrabold text-brand-dark">Platform</h1>
        <p className="text-sm text-ink-600">Switches that apply to everyone, and a record of every owner action.</p>
      </header>
      <Flags />
      <Announcements />
      <AuditLog />
    </div>
  );
}

function Flags() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  useEffect(() => { fetch("/api/owner/flags").then(r => r.json()).then(d => setFlags(d.flags ?? [])).catch(() => setFlags([])); }, []);

  async function toggle(key: string, enabled: boolean) {
    setFlags(fs => fs?.map(f => (f.key === key ? { ...f, enabled } : f)) ?? fs);
    await fetch("/api/owner/flags", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled }),
    }).catch(() => {});
  }

  return (
    <Panel title="Platform flags">
      {flags === null && <Spinner />}
      {flags?.length === 0 && <p className="text-[13px] text-ink-600">No flags registered.</p>}
      <div className="space-y-2.5">
        {(flags ?? []).map(f => (
          <label key={f.key} className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={f.enabled} onChange={e => toggle(f.key, e.target.checked)} className="accent-brand-700 mt-0.5" />
            <span className="min-w-0">
              <span className="text-[13px] font-bold text-ink-900 font-mono">{f.key}</span>
              {f.enabled ? <Badge tone="ok">on</Badge> : <Badge tone="muted">off</Badge>}
              {f.description && <span className="block text-[11px] text-ink-600 leading-snug">{f.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </Panel>
  );
}

function Announcements() {
  const [anns, setAnns] = useState<{ id: string; title: string; body: string; level: string; pinned: boolean; active: boolean; createdAt: string }[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState("info");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/owner/announcements").then(r => r.json()).then(d => setAnns(d.announcements ?? [])).catch(() => setAnns([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/owner/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), level, active: true }),
      });
      setTitle(""); setBody(""); load();
    } finally { setBusy(false); }
  }

  const inp = "border border-line rounded-control px-2.5 py-1.5 text-xs bg-white text-ink-900 w-full";
  return (
    <Panel title="Announcement banner" action={<Megaphone className="w-3.5 h-3.5 text-ink-400" />}>
      <p className="text-[12px] text-ink-600 mb-2">Shown to every tenant at the top of their portal.</p>
      <div className="space-y-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Headline" className={inp} />
        <textarea rows={2} value={body} onChange={e => setBody(e.target.value)} placeholder="What they need to know" className={inp} />
        <div className="flex items-center gap-2">
          <select value={level} onChange={e => setLevel(e.target.value)} className="border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900">
            <option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option>
          </select>
          <button onClick={post} disabled={busy || !title.trim() || !body.trim()}
            className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Publish
          </button>
        </div>
      </div>
      {anns && anns.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line space-y-1.5">
          {anns.slice(0, 5).map(a => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-ink-900">{a.title}</span>
              <span className="flex items-center gap-1.5 shrink-0">
                {a.active ? <Badge tone="ok">live</Badge> : <Badge tone="muted">off</Badge>}
                <span className="text-ink-400">{ago(a.createdAt)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const debounced = useDebounced(q, 300);

  useEffect(() => { setOffset(0); }, [debounced, action]);

  useEffect(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (debounced.trim()) p.set("q", debounced.trim());
    if (action) p.set("action", action);
    fetch(`/api/owner/audit?${p}`).then(r => r.json())
      .then(d => { setRows(d.entries ?? []); setTotal(d.total ?? 0); })
      .catch(() => setRows([]));
  }, [debounced, action, offset]);

  // Derived from what's on screen — enough to jump between the common actions
  // without a second round-trip for a facet list.
  const actions = [...new Set((rows ?? []).map(r => r.action))].sort();

  return (
    <Panel title="Owner audit log" dense action={<ScrollText className="w-3.5 h-3.5 text-ink-400" />}>
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
        <SearchInput value={q} onChange={setQ} placeholder="Search the detail column…" />
        <select value={action} onChange={e => setAction(e.target.value)}
          className="border border-line rounded-control px-2 py-2 text-xs bg-white text-ink-900">
          <option value="">Any action</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {rows === null && <div className="flex justify-center py-12"><Spinner /></div>}
      {rows?.length === 0 && <EmptyState title="Nothing matches" body="Try a different search or clear the action filter." />}

      {rows && rows.length > 0 && (
        <>
          <Table head={<tr><Th>When</Th><Th>Action</Th><Th>Detail</Th><Th>Actor</Th></tr>}>
            {rows.map(e => (
              <tr key={e.id} className="hover:bg-canvas">
                <Td><span className="text-[12px] text-ink-600 whitespace-nowrap">{ago(e.at)}</span></Td>
                <Td><span className="text-[12px] font-bold text-ink-900 font-mono">{e.action}</span></Td>
                <Td><span className="text-[12px] text-ink-600">{e.detail || "—"}</span></Td>
                <Td><span className="text-[11px] text-ink-400 font-mono">{e.actorEmail}</span></Td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between gap-3 p-3 border-t border-line">
            <span className="text-[11px] text-ink-400 tabular-nums">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()}
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => setOffset(o => Math.max(0, o - PAGE))} disabled={offset === 0}
                className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-30">Previous</button>
              <button onClick={() => setOffset(o => o + PAGE)} disabled={offset + PAGE >= total}
                className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-30">Next</button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
