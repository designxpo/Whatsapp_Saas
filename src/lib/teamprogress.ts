// What a team is actually getting done, per person.
//
// A team lead needs one honest question answered — is my team keeping up, and
// who is behind — and the portal had no way to ask it. Analytics is org-wide,
// Live Chat is one chat at a time, and neither says anything about a person.
//
// ── Attribution ──────────────────────────────────────────────────────────────
// Work is attributed by NUMBER, not by name. `assigned_to` holds a display
// string matched by equality, so it orphans the moment somebody is renamed and
// is null on most rows anyway. `wa_users.channel_id` (0075) is a real foreign
// key to the line a person answers, so it survives renames and is what the rest
// of the ownership machinery already uses (handover.ts).
//
// The consequence is worth stating plainly: every conversation on a team's
// numbers is counted exactly once, but only lines with an owner become a
// PERSON's row. Shared lines — Organic, PPC SM, an API number — get their own
// row so the team total still adds up instead of quietly losing chats.
//
// ── Cost ─────────────────────────────────────────────────────────────────────
// One paged read of the team's conversations (pageAll, because a truncated
// answer here would understate somebody's workload and read as slacking), plus
// one HEAD count per number for replies sent. No message bodies are transferred.

import { db } from "./supabase";
import { pageAll } from "./pagedselect";
import { listUsers } from "./team";
import { listChannels } from "./channels";
import { listStages } from "./pipeline";
import { TEAM_SHORT, type Team } from "./teams";
import { DEFAULT_TENANT_ID } from "./tenant";

export interface ProgressRow {
  key: string;                 // channel id — stable across renames
  team: Team;
  who: string;                 // the person who works this line, or the line itself
  channelName: string;
  shared: boolean;             // no member owns this number
  open: number;                // conversations still active
  waiting: number;             // customer spoke last and nobody has replied
  escalated: number;
  activeInRange: number;       // heard from the customer inside the window
  repliedInRange: number;      // a human reply went out inside the window
  humanReplies: number;        // agent-sent messages inside the window
  won: number;                 // moved to a won stage inside the window
  lost: number;
}

export interface TeamProgress {
  team: Team;
  from: string;
  to: string;
  rows: ProgressRow[];
  totals: Omit<ProgressRow, "key" | "team" | "who" | "channelName" | "shared">;
  unownedChats: number;        // on this team's numbers but no conversation row scope
  note: string | null;         // why a number is missing, when one is
}

const EMPTY = { open: 0, waiting: 0, escalated: 0, activeInRange: 0, repliedInRange: 0, humanReplies: 0, won: 0, lost: 0 };

// Human replies per number. A HEAD count returns no rows, so this stays cheap
// even for a number with a hundred thousand messages — and it is per channel,
// so a team of ten numbers costs ten counts, not one scan.
async function humanRepliesByChannel(channelIds: string[], from: string, to: string, tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(channelIds.map(async id => {
    const { count } = await db().from("wa_conv_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("channel_id", id).eq("source", "agent")
      .gte("created_at", from).lte("created_at", to);
    out[id] = count ?? 0;
  }));
  return out;
}

export async function teamProgress(team: Team, opts: { from: string; to: string }, tenantId: string = DEFAULT_TENANT_ID): Promise<TeamProgress> {
  const { from, to } = opts;
  const [users, channels, stages] = await Promise.all([
    listUsers(tenantId).catch(() => []),
    listChannels(tenantId).catch(() => []),
    listStages(tenantId).catch(() => []),
  ]);

  const teamChannels = channels.filter(c => c.team === team && (c.kind ?? "whatsapp") === "whatsapp");
  if (!teamChannels.length) {
    return {
      team, from, to, rows: [], totals: { ...EMPTY }, unownedChats: 0,
      note: `${TEAM_SHORT[team]} has no WhatsApp number yet — assign one in Settings → Numbers and this fills in.`,
    };
  }
  const ids = teamChannels.map(c => c.id);

  // Conversation-level facts only. Deliberately no message-level aggregation:
  // wa_conv_messages is the largest table here and the questions a lead asks
  // are all answerable from the conversation row.
  const convs = await pageAll<Record<string, unknown>>(
    () => db().from("wa_conversations")
      .select("id, phone, channel_id, status, needs_reply, last_inbound_at, last_outbound_at")
      .eq("tenant_id", tenantId)
      .in("channel_id", ids)
      .order("id", { ascending: true }),
    { label: "teamProgress:conversations" },
  ).catch(() => [] as Record<string, unknown>[]);

  // Won/lost inside the window, mapped back to a number through the phone. Only
  // contacts that MOVED in the window count — a lead won last quarter is not
  // this week's progress.
  const wonIds = new Set(stages.filter(s => s.isWon).map(s => s.id));
  const lostIds = new Set(stages.filter(s => s.isLost).map(s => s.id));
  const movedByPhone = new Map<string, "won" | "lost">();
  if (wonIds.size || lostIds.size) {
    const moved = await pageAll<Record<string, unknown>>(
      () => db().from("contacts")
        .select("phone, pipeline_stage_id, pipeline_updated_at")
        .eq("tenant_id", tenantId)
        .not("pipeline_stage_id", "is", null)
        .gte("pipeline_updated_at", from).lte("pipeline_updated_at", to)
        .order("phone", { ascending: true }),
      { label: "teamProgress:pipeline" },
    ).catch(() => [] as Record<string, unknown>[]);
    for (const m of moved) {
      const sid = m.pipeline_stage_id as string;
      if (wonIds.has(sid)) movedByPhone.set(m.phone as string, "won");
      else if (lostIds.has(sid)) movedByPhone.set(m.phone as string, "lost");
    }
  }

  const replies = await humanRepliesByChannel(ids, from, to, tenantId).catch(() => ({} as Record<string, number>));

  const byChannel = new Map<string, ProgressRow>();
  for (const c of teamChannels) {
    // A number may be listed against more than one member during a handover
    // (0075 allows it deliberately), so name them all rather than picking one.
    const owners = users.filter(u => u.active && u.channelId === c.id);
    byChannel.set(c.id, {
      key: c.id,
      team,
      who: owners.length ? owners.map(u => u.name || u.email).join(" + ") : c.name,
      channelName: c.name,
      shared: owners.length === 0,
      ...EMPTY,
      humanReplies: replies[c.id] ?? 0,
    });
  }

  let unownedChats = 0;
  for (const conv of convs) {
    const row = byChannel.get(conv.channel_id as string);
    if (!row) { unownedChats++; continue; }
    const status = (conv.status as string) ?? "active";
    if (status === "active") row.open++;
    if (status === "escalated") row.escalated++;
    if (conv.needs_reply === true) row.waiting++;
    const inb = conv.last_inbound_at as string | null;
    const outb = conv.last_outbound_at as string | null;
    if (inb && inb >= from && inb <= to) row.activeInRange++;
    if (outb && outb >= from && outb <= to) row.repliedInRange++;
    const moved = movedByPhone.get(conv.phone as string);
    if (moved === "won") row.won++;
    else if (moved === "lost") row.lost++;
  }

  // Busiest first: a lead opens this to find who is buried, not to read an
  // alphabetical list. Shared lines sort with everyone else — a shared number
  // drowning in unanswered chats is exactly the thing worth seeing.
  const rows = [...byChannel.values()].sort((a, b) => (b.waiting - a.waiting) || (b.open - a.open) || a.who.localeCompare(b.who));

  const totals = rows.reduce((t, r) => ({
    open: t.open + r.open, waiting: t.waiting + r.waiting, escalated: t.escalated + r.escalated,
    activeInRange: t.activeInRange + r.activeInRange, repliedInRange: t.repliedInRange + r.repliedInRange,
    humanReplies: t.humanReplies + r.humanReplies, won: t.won + r.won, lost: t.lost + r.lost,
  }), { ...EMPTY });

  const sharedCount = rows.filter(r => r.shared).length;
  return {
    team, from, to, rows, totals, unownedChats,
    note: sharedCount
      ? `${sharedCount} of ${rows.length} numbers have nobody assigned — their chats are counted under the number instead of a person. Attach a member in Settings → Team.`
      : null,
  };
}

// Every team at once — the super admin's overall view. Rows keep their team, so
// the same table renders filtered or unfiltered, and the totals are a real sum
// rather than a second, differently-computed number that can disagree with it.
export async function allTeamsProgress(teams: readonly Team[], opts: { from: string; to: string }, tenantId: string = DEFAULT_TENANT_ID): Promise<TeamProgress[]> {
  return Promise.all(teams.map(t => teamProgress(t, opts, tenantId)));
}
