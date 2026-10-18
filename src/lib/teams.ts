// Team scoping — which NUMBERS a person is allowed to work. SERVER ONLY.
//
// The vocabulary and pure rules live in team-vocab.ts so client components can use
// them; this file adds the one lookup that needs the database. Import from here
// only in server code (routes, lib), and from "./team-vocab" in anything marked
// "use client".

import { tdb } from "./tenantdb";
import type { SessionUser } from "./auth";
import type { Team } from "./team-vocab";

export * from "./team-vocab";

// The channel ids this user may see, or null for "no restriction".
//
// null (not an empty array) is the unrestricted signal, because an empty array
// is a real and different answer: a member on a team that owns no numbers yet
// must see NOTHING, and `.in("channel_id", [])` correctly returns nothing.
// Collapsing the two would hand that member the entire inbox.
export async function visibleChannelIds(user: SessionUser | null): Promise<string[] | null> {
  if (!user) return [];                    // unauthenticated → nothing
  if (user.role === "admin") return null;  // super admins see every number
  // Leads and members are scoped identically: a lead runs a team, they do not
  // see outside it. What a lead gets extra is the Team progress view over these
  // same numbers, not a wider set of them.
  const team = user.team ?? null;
  if (!team) return null;                  // unassigned member → legacy full access
  // Scoped to the caller's own workspace as well as the team: a team is a
  // tenant's internal grouping, so "sales" in one tenant owns nothing in another.
  const { data } = await tdb(user.tenantId).from("wa_channels").select("id").eq("team", team);
  return (data ?? []).map(r => (r as unknown as { id: string }).id);
}

