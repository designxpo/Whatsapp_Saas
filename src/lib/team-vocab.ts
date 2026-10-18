// Team vocabulary and the PURE scoping rules — no imports from the server.
//
// This file is imported by client components (Live Chat, Settings, Team Progress)
// for TEAM_SHORT, nextTeam and friends. It must therefore never import the
// database layer: teams.ts does, and pulling that into a browser bundle crashes
// the page at load with "Application error: a client-side exception". The one
// function that needs the database, visibleChannelIds, lives in teams.ts.

// Team scoping — which NUMBERS a person is allowed to work.
//
// The lead lifecycle runs across separate numbers, and each number belongs to
// exactly one team (0073). A member is pinned to one team and the inbox refuses
// anything outside it; admins see everything.
//
// A team is a workspace's own internal grouping of its numbers, not a tenant —
// every lookup here is tenant-scoped on top of being team-scoped.
//
// This file is the ONLY place a team is named or a scope is decided. Routes ask
// visibleChannelIds() and pass the answer down — they never re-derive it, so
// there is one rule to audit rather than one per endpoint.


export const TEAMS = ["marketing", "sales", "ops", "api"] as const;
export type Team = (typeof TEAMS)[number];

// Phase wording the business actually uses, so the portal reads like the org.
export const TEAM_LABELS: Record<Team, string> = {
  marketing: "Marketing — cold / PPC / organic",
  sales: "Sales — conversion",
  ops: "Operations — post-conversion",
  api: "API only — no human inbox",
};

// Short form for chips and pickers where the long label won't fit.
export const TEAM_SHORT: Record<Team, string> = {
  marketing: "Marketing",
  sales: "Sales",
  ops: "Ops",
  api: "API",
};

// ── Roles ─────────────────────────────────────────────────────────────────────
//
// Three rungs, and the difference between them is scope, not seniority:
//
//   admin  — super admin. Every number, every setting. Sees all teams and can
//            filter between them.
//   lead   — runs one team. That team's numbers, plus the Team progress view
//            over them. NOT the platform: settings, numbers, tokens and team
//            management stay with the super admin (requireRoleAdmin).
//   member — works that team's numbers.
//
// A lead is scoped exactly like a member: visibleChannelIds sends everyone who
// is not an admin through the team lookup. So a lead with no team would come
// back unrestricted — the one combination that must not exist. 0076 makes it
// unrepresentable in the database and the API refuses it too.
export const ROLES = ["admin", "lead", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Super admin — every number, every setting",
  lead: "Team lead — their team's numbers + team progress",
  member: "Member — their team's inbox, broadcasts, campaigns",
};

export const ROLE_SHORT: Record<Role, string> = { admin: "Super admin", lead: "Team lead", member: "Member" };

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

// Anything unrecognised becomes the LEAST privileged role. A stale client or a
// hand-written payload must not be able to mint an admin by sending a typo, and
// "member" is the safe direction to fail in.
export function asRole(v: unknown): Role {
  return isRole(v) ? v : "member";
}

// Sees every team, and may switch between them.
export function isSuperAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "admin";
}

// May watch a team's progress: its lead, or a super admin looking at any team.
export function canWatchTeam(
  user: { role?: string | null; team?: Team | null } | null | undefined,
  team: Team,
): boolean {
  if (isSuperAdmin(user)) return true;
  return user?.role === "lead" && user.team === team;
}

export function isTeam(v: unknown): v is Team {
  return typeof v === "string" && (TEAMS as readonly string[]).includes(v);
}

// Normalise anything arriving from a form/JSON body into a Team or null.
// An unrecognised string becomes null rather than throwing: a stale client
// sending a removed team name should leave the number unassigned (visible to
// everyone) instead of failing the whole save.
export function asTeam(v: unknown): Team | null {
  return isTeam(v) ? v : null;
}

// Narrow a requested channel filter to what the user is allowed to see.
//
// Returns the ids to query, or "denied" when the user asked for a number
// outside their team — the caller turns that into a 403 rather than silently
// showing them their own team's chats, which would look like data loss.
export function resolveChannelScope(
  allowed: string[] | null,
  requested: string | null,
): { ids: string[] | null; denied: boolean } {
  if (!requested) return { ids: allowed, denied: false };
  if (allowed === null) return { ids: [requested], denied: false };
  return allowed.includes(requested)
    ? { ids: [requested], denied: false }
    : { ids: [], denied: true };
}

// Whether a single conversation is inside the user's scope. Conversations with
// a null channel_id are env-era rows that belong to no number; a team-scoped
// member must not see them, but an unrestricted user still can.
export function canSeeConversation(allowed: string[] | null, channelId: string | null): boolean {
  if (allowed === null) return true;
  return !!channelId && allowed.includes(channelId);
}

// The funnel, in order. Marketing works the cold lead, sales converts it, ops
// takes it after conversion. `api` is not a phase — it is machine traffic with
// no human inbox, so it never appears as a hand-off destination.
export const TEAM_FLOW: readonly Team[] = ["marketing", "sales", "ops"] as const;

// The team a lead moves to next. null when the current team is unknown, `api`,
// or already at the end of the funnel — the caller then offers a free choice
// instead of a one-click push.
export function nextTeam(team: Team | null | undefined): Team | null {
  if (!team) return null;
  const i = TEAM_FLOW.indexOf(team);
  return i >= 0 && i < TEAM_FLOW.length - 1 ? TEAM_FLOW[i + 1] : null;
}
