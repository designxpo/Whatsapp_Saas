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
import { type GoTo, EmptyState } from "../_shared";
import { TEAMS, TEAM_LABELS, TEAM_SHORT, type Team, type Role } from "@/lib/team-vocab";
import { DataPageHeader, DateRange, ExportCsvButton, LoadStatus } from "@/components/date-range";
import { presetByKey, presetForDays, presetOptions, type PresetKey } from "@/lib/analytics-range";
import { csvFileName, downloadCsv, toCsv } from "@/lib/csv-export";
import { fmtNum } from "@/lib/format";

/** The windows /api/admin/team/progress answers (any 1–90 days; these four are offered). */
const RANGE_KEYS: PresetKey[] = ["24h", "7d", "30d", "90d"];
const RANGE_OPTIONS = presetOptions(RANGE_KEYS);

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
    <div className={`rounded-card border p-4 ${tone === "warn" ? "bg-amber-50 border-amber-200" : "bg-white border-line"}`}>
      <p className="text-[12px] font-semibold text-ink-600">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone === "warn" ? "text-amber-800" : "text-ink-900"}`}>{value}</p>
      {hint && <p className="text-[12px] text-ink-500 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

/** The table as spreadsheet rows, in the order shown on screen. Pure. */
export function progressCsv(rows: ProgressRow[], withTeam: boolean): { header: string[]; rows: (string | number)[][] } {
  const header = ["Who", "Line", ...(withTeam ? ["Team"] : []), "Waiting on us", "Open", "Handed to a person", "Active in period", "Replies by a person", "Won", "Lost"];
  return {
    header,
    rows: rows.map(r => [r.who, r.shared ? "Shared line — nobody assigned" : r.channelName, ...(withTeam ? [TEAM_LABELS[r.team] ?? r.team] : []), r.waiting, r.open, r.escalated, r.activeInRange, r.humanReplies, r.won, r.lost]),
  };
}

export default function TeamProgressTab({ me, goTo }: { me: { role: Role; team?: Team | null } | null; goTo: GoTo }) {
  const isSuper = me?.role === "admin";
  const [scope, setScope] = useState<"all" | Team>(isSuper ? "all" : (me?.team ?? "sales"));
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ProgressResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // A lead's scope follows their team once /me lands — the initial guess above
  // runs before the role is known.
  useEffect(() => { if (!isSuper && me?.team) setScope(me.team); }, [isSuper, me?.team]);

  // The last board stays on screen, dimmed, while a new team or period loads.
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/admin/team/progress?team=${scope}&days=${days}`)
      .then(r => r.json()).then(d => { if (active) { setData(d); setUpdatedAt(Date.now()); } })
      .catch(() => { if (active) setData(prev => ({ ...(prev ?? {}), error: "Couldn't reach Talko — check your connection and try again." })); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope, days]);
  useEffect(() => load(), [load]);

  const rows = data?.rows ?? [];
  const t = data?.totals;
  const period = presetForDays(days, RANGE_KEYS)?.label.toLowerCase() ?? `last ${days} days`;

  function exportCsv() {
    const { header, rows: body } = progressCsv(rows, scope === "all");
    downloadCsv(csvFileName(["team-progress", scope === "all" ? "all-teams" : TEAM_LABELS[scope as Team] ?? scope, period]), toCsv(header, body));
  }

  return (
    <div className="space-y-4">
      <DataPageHeader
        title="Team Progress"
        subtitle={isSuper
          ? "Every team, or one at a time. Each row is a number — with the person who works it, when one is attached."
          : `Your team's numbers for the ${period}. Each row is one line and the person who works it.`}
        status={<LoadStatus loading={loading && !!data} updatedAt={updatedAt} className="mt-1" />}
        controls={<>
          <DateRange options={RANGE_OPTIONS} value={presetForDays(days, RANGE_KEYS)?.key ?? "7d"} onChange={k => setDays(presetByKey(k)?.days ?? 7)} />
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {data?.canFilter && (
              <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-600">
                Team
                <select value={scope} onChange={e => setScope(e.target.value as "all" | Team)}
                  className="min-h-8 border border-line rounded-control px-2.5 text-[13px] bg-white font-semibold text-ink-900">
                  <option value="all">All teams</option>
                  {(data.teams ?? TEAMS).map(tm => <option key={tm} value={tm}>{TEAM_LABELS[tm]}</option>)}
                </select>
              </label>
            )}
            <ExportCsvButton onClick={exportCsv} disabled={!rows.length} />
          </div>
        </>}
      />

      {data?.error && <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{data.error}</p>}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Waiting leads first — it is the only number on this board that is
              somebody's problem right now. */}
          <StatCard label="Waiting on us" value={fmtNum(t.waiting)} tone={t.waiting > 0 ? "warn" : "plain"} hint="Customer spoke last and nobody has replied" />
          <StatCard label="Open chats" value={fmtNum(t.open)} hint="Conversations still active" />
          <StatCard label="Replies by a person" value={fmtNum(t.humanReplies)} hint={`Sent by someone on the team, ${period} — AI replies not counted`} />
          <StatCard label="Won / lost" value={`${fmtNum(t.won)} / ${fmtNum(t.lost)}`} hint={`Moved to a won or lost stage, ${period}`} />
        </div>
      )}

      <div aria-busy={loading} className={`bg-white rounded-card border border-line overflow-x-auto transition-opacity ${loading && data ? "opacity-60" : ""}`}>
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-[12px] font-semibold text-ink-600 border-b border-line">
              <th scope="col" className="px-4 py-2.5">Who</th>
              {scope === "all" && <th scope="col" className="px-3 py-2.5">Team</th>}
              <th scope="col" className="px-3 py-2.5 text-right">Waiting on us</th>
              <th scope="col" className="px-3 py-2.5 text-right">Open</th>
              <th scope="col" className="px-3 py-2.5 text-right">Handed to a person</th>
              <th scope="col" className="px-3 py-2.5 text-right">Active</th>
              <th scope="col" className="px-3 py-2.5 text-right">Replies by a person</th>
              <th scope="col" className="px-3 py-2.5 text-right">Won</th>
              <th scope="col" className="px-3 py-2.5 text-right">Lost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-line last:border-0 hover:bg-canvas">
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-ink-900">{r.who}</p>
                  <p className="text-[12px] text-ink-500">
                    {r.shared ? "Shared line — nobody assigned" : r.channelName}
                  </p>
                </td>
                {scope === "all" && <td className="px-3 py-2.5 text-[12px] font-bold text-brand-800">{TEAM_SHORT[r.team]}</td>}
                <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${r.waiting > 0 ? "text-amber-800" : "text-ink-500"}`}>{fmtNum(r.waiting)}</td>
                <td className="px-3 py-2.5 text-right text-ink-900 tabular-nums">{fmtNum(r.open)}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${r.escalated > 0 ? "text-red-700 font-bold" : "text-ink-500"}`}>{fmtNum(r.escalated)}</td>
                <td className="px-3 py-2.5 text-right text-ink-600 tabular-nums">{fmtNum(r.activeInRange)}</td>
                <td className="px-3 py-2.5 text-right text-ink-600 tabular-nums">{fmtNum(r.humanReplies)}</td>
                <td className="px-3 py-2.5 text-right text-brand-700 font-semibold tabular-nums">{fmtNum(r.won)}</td>
                <td className="px-3 py-2.5 text-right text-ink-600 tabular-nums">{fmtNum(r.lost)}</td>
              </tr>
            ))}
            {!rows.length && !loading && !data?.error && (
              <tr><td colSpan={9}>
                <EmptyState title="No numbers on this team yet"
                  body={data?.note ?? "Rows appear once a WhatsApp number is connected and attached to someone on this team."}
                  action={<button type="button" onClick={() => goTo("settings")} className="min-h-9 rounded-control border border-line bg-white px-4 text-[13px] font-semibold text-brand-800 hover:bg-brand-50">Attach people to numbers in Settings</button>} />
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && !data && <p className="text-xs text-ink-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Loading…</p>}

      {data?.note && !!rows.length && (
        <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{data.note}</p>
      )}

      <p className="text-[12px] text-ink-500 leading-relaxed">
        Work is counted by <b>number</b>, not by the &ldquo;Assigned to&rdquo; label — that label is matched by display
        name and is empty on most chats. Attach each team member to their own line in Settings → Team and their name
        appears here.{" "}
        <button type="button" onClick={() => goTo("livechat")} className="min-h-8 text-brand-800 font-semibold hover:underline">Open Live Chat</button>
      </p>
    </div>
  );
}
