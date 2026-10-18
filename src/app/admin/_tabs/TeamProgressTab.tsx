"use client";

// ── Team Progress ────────────────────────────────────────────────────────────
//
// What a team lead opens to answer one question: is my team keeping up, and who
// is behind. An admin gets the same board across every team, with a filter.
//
// Rows are per NUMBER, because that is how work is actually attributable — see
// the note at the top of lib/teamprogress.ts. A number with somebody attached
// shows their name; a shared line shows the line, so the totals still add up
// instead of quietly dropping chats nobody owns.
import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { type Tab, type GoTo } from "../_shared";
import { TEAMS, TEAM_LABELS, TEAM_SHORT, type Team, type Role } from "@/lib/team-vocab";

type ProgressRow = {
  key: string; team: Team; who: string; channelName: string; shared: boolean;
  open: number; waiting: number; escalated: number; activeInRange: number;
  repliedInRange: number; humanReplies: number; won: number; lost: number;
};
type ProgressResp = {
  scope?: "all" | "team"; team?: Team | null; rows?: ProgressRow[];
  totals?: Omit<ProgressRow, "key" | "team" | "who" | "channelName" | "shared">;
  days?: number; canFilter?: boolean; teams?: Team[]; note?: string | null; error?: string;
};

function StatCard({ label, value, hint, tone = "plain" }: { label: string; value: React.ReactNode; hint?: string; tone?: "plain" | "warn" }) {
  return (
    <div className={`rounded-card border p-4 ${tone === "warn" ? "bg-amber-50 border-amber-200" : "bg-white border-line"}`} title={hint}>
      <p className="text-[11px] font-bold text-ink-400 uppercase tracking-[0.06em]">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === "warn" ? "text-amber-700" : "text-ink-900"}`}>{value}</p>
      {hint && <p className="text-[11px] text-ink-400 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

export default function TeamProgressTab({ me, goTo }: { me: { role: Role; team?: Team | null } | null; goTo: GoTo }) {
  const isSuper = me?.role === "admin";
  const [scope, setScope] = useState<"all" | Team>(isSuper ? "all" : (me?.team ?? "sales"));
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ProgressResp | null>(null);
  const [loading, setLoading] = useState(true);

  // A lead's scope follows their team once /me lands — the initial guess above
  // runs before the role is known.
  useEffect(() => { if (!isSuper && me?.team) setScope(me.team); }, [isSuper, me?.team]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/team/progress?team=${scope}&days=${days}`)
      .then(r => r.json()).then(setData).catch(() => setData({ error: "Could not reach the server" }))
      .finally(() => setLoading(false));
  }, [scope, days]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Team Progress</h2>
          <p className="text-xs text-ink-400 mt-0.5">
            {isSuper
              ? "Every team, or one at a time. Each row is a number — with the person who works it, when one is attached."
              : `Your team's numbers over the last ${days} days. Each row is one line and the person who works it.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.canFilter && (
            <select value={scope} onChange={e => setScope(e.target.value as "all" | Team)}
              className="border border-line rounded-control px-2.5 py-1.5 text-xs bg-white font-semibold text-ink-900">
              <option value="all">All teams</option>
              {(data.teams ?? TEAMS).map(tm => <option key={tm} value={tm}>{TEAM_LABELS[tm]}</option>)}
            </select>
          )}
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border border-line rounded-control px-2.5 py-1.5 text-xs bg-white font-semibold text-ink-900">
            {[1, 7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d} {d === 1 ? "day" : "days"}</option>)}
          </select>
        </div>
      </div>

      {data?.error && <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{data.error}</p>}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Waiting leads first — it is the only number on this board that is
              somebody's problem right now. */}
          <StatCard label="Waiting on us" value={t.waiting} tone={t.waiting > 0 ? "warn" : "plain"} hint="Customer spoke last and nobody has replied" />
          <StatCard label="Open chats" value={t.open} hint="Conversations still active" />
          <StatCard label="Human replies" value={t.humanReplies} hint={`Sent by a person in the last ${days} days — bot replies excluded`} />
          <StatCard label="Won / lost" value={`${t.won} / ${t.lost}`} hint={`Moved to a won or lost stage in the last ${days} days`} />
        </div>
      )}

      <div className="bg-white rounded-card border border-line overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-[11px] font-bold text-ink-400 uppercase tracking-[0.06em] border-b border-line">
              <th className="px-4 py-2.5">Who</th>
              {scope === "all" && <th className="px-3 py-2.5">Team</th>}
              <th className="px-3 py-2.5 text-right" title="Customer spoke last and nobody has replied">Waiting</th>
              <th className="px-3 py-2.5 text-right">Open</th>
              <th className="px-3 py-2.5 text-right">Escalated</th>
              <th className="px-3 py-2.5 text-right" title={`Heard from the customer in the last ${days} days`}>Active</th>
              <th className="px-3 py-2.5 text-right" title="Messages a person sent, bot replies excluded">Replies</th>
              <th className="px-3 py-2.5 text-right">Won</th>
              <th className="px-3 py-2.5 text-right">Lost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-line last:border-0 hover:bg-canvas">
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-ink-900">{r.who}</p>
                  <p className="text-[11px] text-ink-400">
                    {r.shared ? "Shared line — nobody assigned" : r.channelName}
                  </p>
                </td>
                {scope === "all" && <td className="px-3 py-2.5 text-[11px] font-bold text-blue-600">{TEAM_SHORT[r.team]}</td>}
                <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${r.waiting > 0 ? "text-amber-600" : "text-ink-400"}`}>{r.waiting}</td>
                <td className="px-3 py-2.5 text-right text-ink-900 tabular-nums">{r.open}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${r.escalated > 0 ? "text-red-600 font-bold" : "text-ink-400"}`}>{r.escalated}</td>
                <td className="px-3 py-2.5 text-right text-ink-600 tabular-nums">{r.activeInRange}</td>
                <td className="px-3 py-2.5 text-right text-ink-600 tabular-nums">{r.humanReplies}</td>
                <td className="px-3 py-2.5 text-right text-brand-700 font-semibold tabular-nums">{r.won}</td>
                <td className="px-3 py-2.5 text-right text-ink-400 tabular-nums">{r.lost}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-ink-400">
                {data?.note ?? "No numbers on this team yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-xs text-ink-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</p>}

      {data?.note && !!rows.length && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{data.note}</p>
      )}

      <p className="text-[11px] text-ink-400 leading-relaxed">
        Work is counted by <b>number</b>, not by the &ldquo;Assigned to&rdquo; label — that label is matched by display
        name and is empty on most chats. Attach each counsellor to their own line in Settings → Team and their name
        appears here.{" "}
        <button onClick={() => goTo("livechat")} className="text-brand-700 font-semibold hover:underline">Open Live Chat</button>
      </p>
    </div>
  );
}
