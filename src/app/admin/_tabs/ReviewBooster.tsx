"use client";

// Google review booster (review-booster.ts) — owner only until launched. The
// API answers 404 to everyone else, so for them this renders nothing at all.

import { useCallback, useEffect, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { inp } from "../_shared";

interface Config { enabled: boolean; reviewUrl: string; message: string; delayHours: number }
interface Stats { sent: number; opened: number; skipped: number; failed: number; recent: { phoneTail: string; status: string; detail: string | null; sentAt: string; clickedAt: string | null }[]; setupNeeded?: string }

export function ReviewBooster() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [dirty, setDirty] = useState(false);   // edits not saved yet
  const [googleConnected, setGoogleConnected] = useState(false);
  const [note, say] = useNotice();

  const load = useCallback(async (keepEdits = false) => {
    const r = await fetch("/api/admin/review-booster").catch(() => null);
    if (!r?.ok) { setHidden(true); return; }
    const j = await r.json();
    if (!keepEdits) { setCfg(j.config); setDirty(false); }
    setStats(j.stats); setGoogleConnected(!!j.googleConnected); setHidden(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (hidden || !cfg) return null;

  // Returns whether it worked. A failed save keeps what was typed, so the
  // owner can see and fix it rather than finding the box emptied.
  async function post(body: Record<string, unknown>, done: (j: Record<string, unknown>) => string, keepEdits = false): Promise<boolean> {
    setBusy(true); say(null);
    const r = await fetch("/api/admin/review-booster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok || j.error) { say(j.error || `That didn't work (HTTP ${r?.status ?? "offline"}).`); return false; }
    say(done(j), j.status === "skipped" || j.status === "failed" ? "warn" : "ok");
    load(keepEdits);
    return true;
  }
  const edit = (patch: Partial<Config>) => { if (cfg) { setCfg({ ...cfg, ...patch }); setDirty(true); } };
  const save = () => post(cfg as unknown as Record<string, unknown>, () => "Saved.");
  // Sending uses the saved link, so save what's typed first.
  async function send() {
    if (dirty && !(await save())) return;
    await post({ sendTo: phone }, j => j.status === "sent" ? "Sent on WhatsApp." : j.status === "duplicate" ? "Already asked." : String(j.detail ?? j.status));
  }

  return (
    <section className="bg-white rounded-card border border-amber-200 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="group flex items-center gap-1.5">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-amber-400" /> Review booster</p>
          <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">Owner preview · not live</span>
          <PageInfo>After a paid order, one WhatsApp message asks for a Google review with a tracked link, and offers a private reply if something wasn&apos;t right. Everyone is asked the same way: Google bans sending only happy customers. Sent only inside WhatsApp&apos;s 24-hour window; outside it needs an approved template. Only you can see this.</PageInfo>
        </div>
      </div>
      {stats?.setupNeeded && <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{stats.setupNeeded}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <input className={`${inp} flex-1 min-w-[16rem]`} placeholder="Your Google review link (https://g.page/r/…/review or https://share.google/…)" value={cfg.reviewUrl} onChange={e => edit({ reviewUrl: e.target.value })} />
          {googleConnected && (
            <button type="button" disabled={busy} onClick={() => post({ fromGoogle: true }, () => "Filled in from your Google Business Profile and saved.")} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas disabled:opacity-60">Use my Google profile&apos;s link</button>
          )}
        </div>
        <textarea className={`${inp} sm:col-span-2`} rows={2} value={cfg.message} onChange={e => edit({ message: e.target.value })} />
        <label className="text-[12px] text-ink-600 flex items-center gap-2">Ask <input type="number" min={0} max={72} className={`${inp} w-16`} value={cfg.delayHours} onChange={e => edit({ delayHours: Number(e.target.value) })} /> hours after payment</label>
        <label className="text-[12px] text-ink-700 font-semibold flex items-center gap-2 cursor-pointer"><input type="checkbox" className="accent-amber-500" checked={cfg.enabled} onChange={e => edit({ enabled: e.target.checked })} /> Ask automatically after paid orders</label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 inline-flex items-center gap-1.5">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save{dirty ? " changes" : ""}</button>
        <span className="text-[11px] text-slate-400">or ask one customer now:</span>
        <input className={`${inp} w-44`} placeholder="98XXXXXXXX" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
        <button onClick={send} disabled={busy || phone.replace(/\D/g, "").length < 10} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas disabled:opacity-60">Send request</button>
      </div>
      <p className="text-[11px] text-slate-500">WhatsApp only delivers this to a customer who messaged you in the last 24 hours. To try it yourself, message your business WhatsApp number from your phone first, then send to that number.</p>
      <Notice notice={note} onClose={() => say(null)} />
      {stats && (
        <p className="text-[12px] text-slate-500 tabular-nums">Last 30 days: <b className="text-ink-900">{stats.sent}</b> asked · <b className="text-ink-900">{stats.opened}</b> opened the link{stats.sent ? ` (${Math.round((stats.opened / stats.sent) * 100)}%)` : ""} · {stats.skipped} outside the 24-hour window{stats.failed ? ` · ${stats.failed} failed` : ""}</p>
      )}
    </section>
  );
}
