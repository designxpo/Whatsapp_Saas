import { NextResponse } from "next/server";
import { currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { teamProgress, allTeamsProgress, type ProgressRow } from "@/lib/teamprogress";
import { TEAMS, isTeam, isSuperAdmin, canWatchTeam, type Team } from "@/lib/teams";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?team=<team|all>&days=N — how a team is doing, per number and per person.
//
// Who may ask, and about whom, is the whole point of the endpoint:
//   • super admin — any team, or `all` for the overall view
//   • team lead   — their own team, and nothing else. Another team is a 403,
//                   not a silent redirect to their own: being shown someone
//                   else's numbers under their team's name is worse than being
//                   refused.
//   • member      — 403. Watching the team is the lead's job.
//
// Enforced here rather than by hiding the tab: the nav is presentation, and
// /api/admin/* is gated to "signed in" by the middleware, never to a role.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = user.tenantId || DEFAULT_TENANT_ID;
  if (user.role !== "admin" && user.role !== "lead") {
    return NextResponse.json({ error: "Team progress is for team leads and admins." }, { status: 403 });
  }

  const url = new URL(req.url);
  const requested = url.searchParams.get("team");
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    // "all" is the super admin's default; a lead always lands on their own team.
    if (isSuperAdmin(user) && (!requested || requested === "all")) {
      const boards = await allTeamsProgress(TEAMS, { from, to }, tid);
      const rows: ProgressRow[] = boards.flatMap(b => b.rows);
      return NextResponse.json({
        scope: "all", team: null, from, to, days, rows,
        totals: sum(rows),
        canFilter: true, teams: TEAMS,
        note: boards.map(b => b.note).filter(Boolean)[0] ?? null,
      });
    }

    const team: Team | null = isTeam(requested) ? requested : (user.team ?? null);
    if (!team) return NextResponse.json({ error: "No team to report on — pick one." }, { status: 400 });
    if (!canWatchTeam(user, team)) {
      return NextResponse.json({ error: `You lead ${user.team ?? "no team"}, so you can't open another team's board.` }, { status: 403 });
    }
    const p = await teamProgress(team, { from, to }, tid);
    return NextResponse.json({ scope: "team", ...p, days, canFilter: isSuperAdmin(user), teams: isSuperAdmin(user) ? TEAMS : [team] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function sum(rows: ProgressRow[]) {
  return rows.reduce((t, r) => ({
    open: t.open + r.open, waiting: t.waiting + r.waiting, escalated: t.escalated + r.escalated,
    activeInRange: t.activeInRange + r.activeInRange, repliedInRange: t.repliedInRange + r.repliedInRange,
    humanReplies: t.humanReplies + r.humanReplies, won: t.won + r.won, lost: t.lost + r.lost,
  }), { open: 0, waiting: 0, escalated: 0, activeInRange: 0, repliedInRange: 0, humanReplies: 0, won: 0, lost: 0 });
}
