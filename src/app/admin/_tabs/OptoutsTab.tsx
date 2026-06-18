"use client";

// Opt-outs tab (+ its sidebar rail) — extracted from admin/page.tsx, lazy-loaded.
import { useState, useEffect, useCallback } from "react";
import { inp, RailCard, StatRow } from "../_shared";

function OptoutsTab() {
  const [list, setList] = useState<{ phone: string; reason: string | null; createdAt?: string }[]>([]);
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(() => { fetch("/api/admin/optouts").then(r => r.json()).then(d => setList(d.optouts ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  async function add() { if (!phone.trim()) return; await fetch("/api/admin/optouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim(), reason: "added by team" }) }); setPhone(""); load(); }
  async function remove(p: string) {
    if (!confirm(`Remove ${p} from the opt-out list? They will start receiving broadcasts again.`)) return;
    await fetch("/api/admin/optouts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: p }) });
    load();
  }
  const visible = list.filter(o => !search.trim() || o.phone.includes(search.replace(/\D/g, "")));
  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-xl space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Opt-outs</h2>
        <p className="text-sm text-slate-500">Numbers that asked to stop hearing from you. Every broadcast, auto-send, and AI reply skips them automatically.</p>
      </div>
      <div className="flex gap-2">
        <input className={`${inp} flex-1`} placeholder="Number to suppress — e.g. 919876543210" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
        <button onClick={add} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">Add</button>
      </div>
      {list.length > 5 && (
        <input className={`${inp} w-full`} placeholder="Search the list…" value={search} onChange={e => setSearch(e.target.value)} />
      )}
      <div className="bg-white rounded-card border border-line divide-y divide-slate-100">
        {visible.map(o => (
          <div key={o.phone} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-mono text-ink-900">{o.phone}</p>
              <p className="text-[11px] text-slate-400">
                {o.reason === "inbound STOP" ? "Replied STOP themselves" : o.reason || "Added manually"}
                {o.createdAt ? ` · ${new Date(o.createdAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <button onClick={() => remove(o.phone)} className="text-xs text-red-500 hover:underline shrink-0">Remove</button>
          </div>
        ))}
        {visible.length === 0 && <p className="text-center text-slate-400 text-sm py-6">{list.length === 0 ? "No opt-outs — when someone replies STOP they appear here automatically." : "No matches."}</p>}
      </div>
    </div>
    <OptoutsRail list={list} />
    </div>
  );
}

// Opt-outs: split by source + the compliance story in plain language.
function OptoutsRail({ list }: { list: { reason: string | null }[] }) {
  const viaStop = list.filter(o => o.reason === "inbound STOP").length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Suppression list">
        <StatRow label="Total opted out" value={list.length} />
        <StatRow label="Replied STOP themselves" value={viaStop} />
        <StatRow label="Added by your team" value={list.length - viaStop} />
      </RailCard>
      <RailCard title="How it works — automatic">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>A customer replying <b>STOP</b>, <b>UNSUBSCRIBE</b>, <b>CANCEL</b>, or <b>OPT OUT</b> is suppressed instantly and gets a confirmation.</li>
          <li>Every broadcast, auto-send, and AI reply <b>skips this list</b> — nothing for you to remember.</li>
          <li>Replying <b>START</b> opts them back in automatically, with a welcome-back message.</li>
          <li>Skipped sends show up in each campaign&apos;s funnel, so the numbers always add up.</li>
        </ul>
      </RailCard>
      <RailCard title="Why this protects your number">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Messaging people who said stop leads to <b>blocks and reports</b> — Meta lowers your number&apos;s quality rating and can shrink your daily sending limit.</li>
          <li>Honouring STOP keeps the <b>green quality rating</b> that unlocks higher messaging tiers.</li>
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Keep &quot;Reply STOP to opt out&quot; in template footers — it builds trust and avoids spam reports.</li>
          <li>Add a number manually when someone asks to stop via call or email.</li>
          <li>Only remove a number when the person clearly asked to hear from you again.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

export default OptoutsTab;
