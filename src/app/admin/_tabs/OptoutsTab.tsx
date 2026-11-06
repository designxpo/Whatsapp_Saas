"use client";

// Opt-outs tab (+ its sidebar rail) — extracted from admin/page.tsx, lazy-loaded.
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { adminFetch } from "@/lib/adminfetch";
import { inp, RailCard, StatRow, EmptyState } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";

type Optout = { phone: string; reason: string | null; createdAt?: string };

function OptoutsTab() {
  const ask = useConfirm();
  // Taking someone off the list is admin-only on the server (DELETE
  // /api/admin/optouts); adding someone stays open to everyone.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { fetch("/api/admin/me").then(r => r.json()).then(d => setIsAdmin(d.user?.role === "admin")).catch(() => {}); }, []);
  const [list, setList] = useState<Optout[]>([]);
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await adminFetch<{ optouts?: Optout[] }>("/api/admin/optouts");
    if (!r.ok) { setErr(`Couldn't load the opt-out list — ${r.error}`); return; }
    setErr(null); setList(r.data.optouts ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  // A suppress that fails silently keeps broadcasting to someone who asked to
  // stop — the one failure here that costs the number its quality rating. Say
  // so, and keep the typed number so it can be retried.
  async function add() {
    if (!phone.trim()) return;
    const p = phone.trim();
    const r = await adminFetch("/api/admin/optouts", { method: "POST", body: { phone: p, reason: "added by team" } });
    if (!r.ok) { setErr(`Couldn't add ${p} to the list — ${r.error}`); return; }
    setErr(null); setPhone(""); load();
    toast(`${p} won't get any more messages`);
  }
  async function remove(p: string) {
    if (!(await ask({
      title: "Put this person back on broadcasts?", tone: "caution", confirmLabel: "Remove from opt-outs",
      message: "They asked to stop, either by replying STOP or by being opted out here. Only do this if they have since asked to be re-subscribed.",
      facts: [{ label: "Number", value: p }],
    }))) return;
    const r = await adminFetch("/api/admin/optouts", { method: "DELETE", body: { phone: p } });
    if (!r.ok) { setErr(`Couldn't remove ${p} — ${r.error}`); return; }
    setErr(null); load();
    // Undone by putting the number straight back on the list (same endpoint, POST).
    toast({ text: `${p} can get your messages again`, action: { label: "Undo", onClick: () => {
      void adminFetch("/api/admin/optouts", { method: "POST", body: { phone: p, reason: "added by team" } }).then(x => {
        if (x.ok) toast(`${p} is back on the Do Not Contact list`); else toast({ text: `Couldn't put ${p} back — please add it again.`, tone: "error" });
        load();
      });
    } } });
  }
  const visible = list.filter(o => !search.trim() || o.phone.includes(search.replace(/\D/g, "")));
  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-xl space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Do Not Contact</h2><p className="text-sm text-slate-500">People who asked to stop hearing from you. Every broadcast, automatic message and AI reply skips them on its own.</p>
      </div>
      {err && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{err}</div>}
      <div className="flex gap-2">
        <input className={`${inp} flex-1 min-w-0`} inputMode="tel" aria-label="Number to stop messaging" placeholder="Number to stop messaging — e.g. 919876543210" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
        <button onClick={add} disabled={!phone.trim()} title={!phone.trim() ? "Type the number first" : undefined} className="min-h-10 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">Add</button>
      </div>
      {!phone.trim() && <p className="-mt-2 text-[12px] text-slate-500">Type a number (with country code) to add someone who asked by phone or email.</p>}
      {list.length > 5 && (
        <input className={`${inp} w-full`} type="search" aria-label="Search the list" placeholder="Search the list…" value={search} onChange={e => setSearch(e.target.value)} />
      )}
      <div className="bg-white rounded-card border border-line divide-y divide-slate-100">
        {visible.map(o => (
          <div key={o.phone} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-mono text-ink-900">{o.phone}</p>
              <p className="text-[12px] text-slate-500">
                {o.reason === "inbound STOP" ? "Replied STOP themselves" : o.reason || "Added manually"}
                {o.createdAt ? ` · ${new Date(o.createdAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            {isAdmin && <button onClick={() => remove(o.phone)} aria-label={`Remove ${o.phone} from the list`} className="min-h-8 px-2 rounded-control text-xs font-semibold text-red-700 hover:bg-red-50 shrink-0">Remove</button>}
          </div>
        ))}
        {visible.length === 0 && (list.length === 0
          ? <EmptyState mood="happy" title="Nobody has asked to stop"
              body="When someone replies STOP they're added here on their own and never messaged again. If someone asks by phone or email, type their number above." />
          : <p className="text-center text-slate-500 text-sm py-6">No number on the list matches “{search}”.</p>)}
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
      <RailCard title="Do Not Contact list">
        <StatRow label="Total on the list" value={list.length} />
        <StatRow label="Replied STOP themselves" value={viaStop} />
        <StatRow label="Added by your team" value={list.length - viaStop} />
      </RailCard>
      <RailCard title="How it works — automatic">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>A customer replying <b>STOP</b>, <b>UNSUBSCRIBE</b>, <b>CANCEL</b>, or <b>OPT OUT</b> is added straight away and gets a confirmation.</li>
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
