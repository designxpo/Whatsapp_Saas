"use client";

// What "Continue on WhatsApp" produced on one platform (handoff.ts): invites
// sent, chats started on WhatsApp, and the paid orders and revenue those
// numbers placed afterwards — overall for the range, and per person.

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Loader2, RefreshCw } from "lucide-react";
import { PageInfo } from "@/components/PageInfo";
import { SegmentedControl } from "@/components/SegmentedControl";

type Platform = "instagram" | "facebook" | "youtube";
interface Row {
  id: string; code: string; postId: string | null; sourceText: string | null; sourceAuthor: string | null;
  createdAt: string; claimedAt: string | null; orders: number; revenueCents: number;
}
interface Summary { sent: number; started: number; orders: number; revenueCents: number }
type Range = "7" | "30" | "90" | "365";
const RANGES: { value: Range; label: string }[] = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "1 year" }];
const NAME: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
const PAGE = 25;
const rupees = (c: number) => `₹${Math.round(c / 100).toLocaleString("en-IN")}`;
function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return m < 1 ? "just now" : `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function HandoffResults({ platform }: { platform: Platform }) {
  const [range, setRange] = useState<Range>("30");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [next, setNext] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (days: Range, cursor: string | null) => {
    const q = new URLSearchParams({ platform, days });
    if (cursor) q.set("cursor", cursor);
    const r = await fetch(`/api/admin/handoffs?${q}`).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setError(j.error || "Couldn't load the WhatsApp handoffs."); setRows(p => p ?? []); return false; }
    setError(null); setSetup(j.setupNeeded ?? null); setRows(j.rows ?? []); setNext(j.next ?? null);
    if (!cursor) setSummary(j.summary ?? null);
    return true;
  }, [platform]);
  useEffect(() => { setRows(null); setCursors([null]); load(range, null); }, [load, range]);

  const page = cursors.length - 1;
  async function goTo(dir: 1 | -1) {
    setPaging(true);
    if (dir === 1 && next) { if (await load(range, next)) setCursors(c => [...c, next]); }
    if (dir === -1 && page > 0) { if (await load(range, cursors[page - 1])) setCursors(c => c.slice(0, -1)); }
    setPaging(false);
  }

  const tiles: [string, string][] = summary ? [
    ["Invites sent", summary.sent.toLocaleString()],
    ["Chats started", `${summary.started.toLocaleString()}${summary.sent ? ` · ${Math.round((summary.started / summary.sent) * 100)}%` : ""}`],
    ["Orders", summary.orders.toLocaleString()],
    ["Revenue", rupees(summary.revenueCents)],
  ] : [];

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="group flex items-center gap-1.5">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> Continued on WhatsApp</p>
          <PageInfo>
            People your {NAME[platform]} comment rules invited to WhatsApp with &ldquo;Continue on WhatsApp&rdquo;, and what happened next. A chat counts as started when they message you with their code; orders and revenue are paid orders from that number afterwards.
          </PageInfo>
        </div>
        <button onClick={() => { setRows(null); load(range, cursors[page]); }} aria-label="Refresh" className="p-1.5 rounded-control text-slate-500 hover:bg-canvas hover:text-ink-900"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      {setup ? <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{setup}</p> : <>
        <SegmentedControl options={RANGES} value={range} onChange={setRange} size="sm" ariaLabel="Show handoffs from" className="max-w-sm" />
        {error && <p className="text-[12px] text-red-600">{error}</p>}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-control border border-line px-3 py-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.06em]">{label}</p>
                <p className="text-lg font-extrabold text-ink-900 tabular-nums leading-tight">{value}</p>
              </div>
            ))}
          </div>
        )}
        {rows === null ? (
          <div role="status" aria-label="Loading" className="space-y-2">{[0, 1].map(i => <div key={i} className="h-12 rounded-control bg-canvas animate-pulse" />)}</div>
        ) : !rows.length ? (
          <p className="text-[13px] text-slate-500">Nobody invited in this range yet. Turn on <b>Continue on WhatsApp</b> in a comment rule above to start.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(r => (
              <li key={r.id} className="py-2.5 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-slate-500 truncate"><b className="text-ink-900">{r.sourceAuthor || "Someone"}</b> · invited {ago(r.createdAt)} · code <code className="text-[11px]">{platform === "youtube" ? r.code : r.code.slice(0, 4) + "…"}</code></p>
                  {r.sourceText && <p className="text-[13px] text-ink-700 truncate">“{r.sourceText}”</p>}
                </div>
                <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${r.orders ? "bg-emerald-50 text-emerald-700" : r.claimedAt ? "bg-brand-50 text-brand-700" : "bg-canvas text-slate-500"}`}>
                  {r.orders ? `${r.orders} order${r.orders > 1 ? "s" : ""} · ${rupees(r.revenueCents)}` : r.claimedAt ? `Chat started ${ago(r.claimedAt)}` : "Not yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length > 0 && (page > 0 || next) && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-slate-500 tabular-nums">{page * PAGE + 1}–{page * PAGE + rows.length}{summary ? ` of ${summary.sent.toLocaleString()}` : ""}</span>
            <div className="flex items-center gap-1.5">
              {paging && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              <button onClick={() => goTo(-1)} disabled={paging || page === 0} className="px-2.5 py-1 rounded-control border border-line text-[11px] font-bold text-ink-700 hover:bg-canvas disabled:opacity-40">Newer</button>
              <button onClick={() => goTo(1)} disabled={paging || !next} className="px-2.5 py-1 rounded-control border border-line text-[11px] font-bold text-ink-700 hover:bg-canvas disabled:opacity-40">Older</button>
            </div>
          </nav>
        )}
      </>}
    </section>
  );
}
