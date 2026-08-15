"use client";

// Waitlist — interest submissions from the marketing site, worked as a pipeline.

import { useCallback, useEffect, useState } from "react";
import { Inbox, Mail, Trash2 } from "lucide-react";
import { Panel, Badge, EmptyState, Spinner, ConfirmDialog, ago, type ConfirmCfg, type Tone } from "../_ui";

type Row = {
  id: string; name: string; email: string; phone: string | null; company: string | null;
  plan: string | null; channels: string[]; message: string | null; status: string; createdAt: string;
};

const STATUSES = ["new", "contacted", "converted", "archived"];
const TONE: Record<string, Tone> = { new: "info", contacted: "warn", converted: "ok", archived: "muted" };
const sel = "border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900";

export default function WaitlistPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("");
  const [confirmCfg, setConfirmCfg] = useState<ConfirmCfg | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/owner/waitlist");
      const d = await r.json();
      if (!r.ok || d.error) { setErr(d.error || "Couldn't load the waitlist."); setRows([]); return; }
      setErr(null); setRows(d.entries ?? []);
    } catch { setErr("Couldn't reach the server."); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    setRows(rs => rs?.map(w => (w.id === id ? { ...w, status } : w)) ?? rs);   // optimistic
    const r = await fetch("/api/owner/waitlist", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }),
    }).catch(() => null);
    // A silently-failed status change would leave the pipeline lying, so re-read.
    if (!r || !r.ok) { setErr("That status change didn't save — reloading."); load(); }
  }

  const visible = (rows ?? []).filter(w => !filter || w.status === filter);
  const counts = STATUSES.map(s => ({ s, n: (rows ?? []).filter(w => w.status === s).length }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-extrabold text-brand-dark">Waitlist</h1>
        <p className="text-sm text-ink-600">People who asked for access from the marketing site.</p>
      </header>

      {err && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{err}</div>}

      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          <button onClick={() => setFilter("")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${!filter ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
            All {rows?.length ?? 0}
          </button>
          {counts.map(({ s, n }) => (
            <button key={s} onClick={() => setFilter(filter === s ? "" : s)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold capitalize ${filter === s ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
              {s} {n}
            </button>
          ))}
        </div>

        {rows === null && <div className="flex justify-center py-16"><Spinner /></div>}
        {rows !== null && !visible.length && (
          <EmptyState icon={<Inbox className="w-5 h-5" />}
            title={filter ? `Nothing marked ${filter}` : "No submissions yet"}
            body={filter ? undefined : "They appear here the moment someone joins the waitlist on the marketing site."} />
        )}

        <div className="divide-y divide-line">
          {visible.map(w => (
            <div key={w.id} className="px-4 py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-ink-900 truncate">{w.name || "—"}</span>
                  {w.company && <span className="text-[11px] text-ink-600">· {w.company}</span>}
                  {w.plan && <Badge tone="info">{w.plan}</Badge>}
                  <Badge tone={TONE[w.status] ?? "muted"}>{w.status}</Badge>
                </div>
                <p className="text-[11px] text-ink-600 mt-0.5 flex items-center gap-2 flex-wrap">
                  <a href={`mailto:${w.email}`} className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline"><Mail className="w-3 h-3" />{w.email}</a>
                  {w.phone && <span className="font-mono">{w.phone}</span>}
                  <span className="text-ink-400">· {ago(w.createdAt)}</span>
                </p>
                {w.channels.length > 0 && <p className="text-[11px] text-ink-400 mt-1">Channels: {w.channels.join(", ")}</p>}
                {w.message && <p className="text-[12px] text-ink-600 mt-1 bg-canvas rounded-control px-2 py-1 whitespace-pre-wrap">{w.message}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <select value={w.status} onChange={e => setStatus(w.id, e.target.value)} className={sel} title="Move through the pipeline">
                  {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
                <button title="Delete"
                  onClick={() => setConfirmCfg({
                    title: "Delete submission",
                    message: <>Delete the submission from <b>{w.name || w.email}</b>? This can&apos;t be undone.</>,
                    confirmLabel: "Delete",
                    onConfirm: async () => {
                      const r = await fetch("/api/owner/waitlist", {
                        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: w.id }),
                      });
                      if (!r.ok) throw new Error("Delete failed.");
                      setRows(rs => rs?.filter(x => x.id !== w.id) ?? rs);
                    },
                  })}
                  className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-control"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {confirmCfg && <ConfirmDialog cfg={confirmCfg} onDone={() => setConfirmCfg(null)} />}
    </div>
  );
}
