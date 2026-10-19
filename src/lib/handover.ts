// Handing a lead on — sales → ops, and keeping portal ownership in step with
// LeadSquared.
//
// A lead changes hands two ways, and both go through ONE decision function:
//
//   • a counsellor pushes it on          — "Hand to Ops" in Live Chat
//   • LeadSquared re-owns it             — the CRM is the system of record for
//     who owns a lead, so an owner change there is mirrored into the portal
//
// The two models differ, which is the whole problem this file solves. LSQ owns
// a lead by PERSON (OwnerIdEmailAddress). The portal owns it by NUMBER
// (wa_conversations.channel_id) — because that is what team scoping reads
// (teams.ts) and what replies actually go out from. resolveOwnerTarget is the
// translation: owner email → portal member (0075) → their number → its team.
//
// Before this, the LSQ webhook wrote only assigned_to, which is a display name.
// The chat stayed on the sales number, so the ops person it named still could
// not open it: the label said one thing and the scope said another.
//
// Nothing here guesses. When the owner maps to no single number, the chat is
// left where it is and the caller is told why — a wrong guess would send the
// next reply from a line the customer has never seen, and burn that number's
// 24-hour window instead of the one already open.

import { TEAM_SHORT, type Team } from "./teams";
import { listUsers } from "./team";
import { listChannels } from "./channels";
import { fetchLeadDetails, lsqConfigured, lsqPaused } from "./leadsquared";
import {
  assignConversation, reassignConversationChannel, getConversationByPhone,
  getContactByPhoneLoose, setContactAttributes, getTenantSetting, setTenantSetting, tenantIdsWithSetting,
  type Conversation,
} from "./store";
import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";

export interface OwnerCandidateUser {
  email: string;
  name: string;
  active: boolean;
  team: Team | null;
  channelId: string | null;
}

export interface OwnerCandidateChannel {
  id: string;
  name: string;
  active: boolean;
  team: Team | null;
  kind?: string | null;
}

export interface OwnerTarget {
  assignTo: string | null;    // wa_conversations.assigned_to; null = leave alone
  channelId: string | null;   // number to move to; null = leave the chat where it is
  team: Team | null;          // the team that ends up owning it
  note: string;               // why — goes on the ownership trail and the API response
}

const none = (note: string): OwnerTarget => ({ assignTo: null, channelId: null, team: null, note });

// Which of our numbers a LeadSquared owner maps to.
export function resolveOwnerTarget(
  ownerEmail: string | null | undefined,
  users: OwnerCandidateUser[],
  channels: OwnerCandidateChannel[],
  current: { channelId: string | null; platform?: string | null },
): OwnerTarget {
  const email = (ownerEmail ?? "").trim().toLowerCase();
  if (!email) return none("the lead has no owner in LeadSquared");

  const user = users.find(u => u.active && u.email.trim().toLowerCase() === email);
  if (!user) return none(`${email} isn't a portal team member — add them under Settings → Team`);

  // An empty display name would UNassign the chat, so a member without one
  // assigns nothing. Their NUMBER can still move, and that is what actually
  // grants their team access — the name is only a label.
  const assignTo = user.name.trim() || null;
  const who = assignTo ?? email;
  const team = user.team;

  // Only ever move a WhatsApp chat onto a WhatsApp number. An Instagram,
  // Messenger or web-chat conversation has no counterpart line to move to.
  const platform = current.platform ?? "whatsapp";
  const usable = channels.filter(c => c.active && (c.kind ?? "whatsapp") === platform);

  // 1) The member's own line (0075) — the precise answer, and the reason that
  //    column exists.
  const own = user.channelId ? usable.find(c => c.id === user.channelId) : undefined;
  if (own) {
    return own.id === current.channelId
      ? { assignTo, channelId: null, team, note: `${who} already works this number` }
      : { assignTo, channelId: own.id, team, note: `LeadSquared owner ${who} → ${own.name}` };
  }

  if (!team) {
    return { assignTo, channelId: null, team: null, note: `${who} isn't on a team, so the number was left alone` };
  }

  const teamChannels = usable.filter(c => c.team === team);

  // 2) Already inside the owner's team — the right people can see it. Moving it
  //    between two of that team's numbers would change nothing except which
  //    24-hour window the next reply needs.
  if (current.channelId && teamChannels.some(c => c.id === current.channelId)) {
    return { assignTo, channelId: null, team, note: `already on a ${TEAM_SHORT[team]} number` };
  }

  // 3) The team owns exactly one number — unambiguous.
  if (teamChannels.length === 1) {
    return { assignTo, channelId: teamChannels[0].id, team, note: `LeadSquared owner ${who} → ${TEAM_SHORT[team]} (${teamChannels[0].name})` };
  }

  // 4) Ambiguous, or the team has no line at all. Say which, because both are
  //    fixable in Settings and neither is visible from the chat.
  return {
    assignTo, channelId: null, team,
    note: teamChannels.length
      ? `${TEAM_SHORT[team]} has ${teamChannels.length} numbers and ${who} has no personal line — set one in Settings → Team, or hand it over by hand`
      : `${TEAM_SHORT[team]} has no ${platform} number yet — add one in Settings → Numbers`,
  };
}

// The number a "hand to <team>" push should land on.
//
// Deliberately narrower than resolveOwnerTarget: a person clicked a team, so
// there is no owner to honour. One number → do it. Several → the caller must
// pick, and gets the list to offer rather than a silent choice.
export function resolveTeamTarget(
  team: Team,
  channels: OwnerCandidateChannel[],
  current: { channelId: string | null; platform?: string | null },
): { channelId: string | null; choices: OwnerCandidateChannel[]; error: string | null } {
  const platform = current.platform ?? "whatsapp";
  const teamChannels = channels.filter(c => c.active && (c.kind ?? "whatsapp") === platform && c.team === team);
  if (!teamChannels.length) {
    return { channelId: null, choices: [], error: `${TEAM_SHORT[team]} has no ${platform} number yet — add one in Settings → Numbers and set its team.` };
  }
  if (current.channelId && teamChannels.some(c => c.id === current.channelId)) {
    return { channelId: null, choices: teamChannels, error: null };   // already there — a no-op, not a failure
  }
  if (teamChannels.length === 1) return { channelId: teamChannels[0].id, choices: teamChannels, error: null };
  return { channelId: null, choices: teamChannels, error: `${TEAM_SHORT[team]} works ${teamChannels.length} numbers — choose which one takes this lead.` };
}

// ── Applying a decision ───────────────────────────────────────────────────────

export interface HandoverResult {
  moved: boolean;          // the conversation changed number
  assigned: string | null; // who it now reads as, when that changed
  team: Team | null;
  note: string;
}

// Write a resolved target to the conversation. Assign and move are independent:
// a target can name a person without moving the number (they already work it),
// and can move the number without naming a person (a member with no display
// name). Both are best-effort — failing to relabel a chat must not stop the
// move that actually hands it over.
export async function applyOwnerTarget(
  conv: Pick<Conversation, "id" | "assignedTo" | "channelId">,
  target: OwnerTarget,
  changedBy: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<HandoverResult> {
  let assigned: string | null = null;
  if (target.assignTo && target.assignTo !== conv.assignedTo) {
    await assignConversation(conv.id, target.assignTo).catch(() => undefined);
    assigned = target.assignTo;
  }
  let moved = false;
  if (target.channelId && target.channelId !== conv.channelId) {
    try {
      await reassignConversationChannel(conv.id, target.channelId, changedBy, target.note, tenantId);
      moved = true;
    } catch (e) {
      console.error("[handover] reassign failed", conv.id, e);
    }
  }
  return { moved, assigned, team: target.team, note: target.note };
}

// Resolve + apply in one call, reading the current team/number picture. Used by
// the LSQ webhook, the manual "sync now" button and the cron sweep, so all
// three land on identical rules.
export async function handToOwner(
  conv: Pick<Conversation, "id" | "assignedTo" | "channelId" | "platform">,
  ownerEmail: string | null | undefined,
  changedBy: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<HandoverResult> {
  // Both lists are THIS workspace's own, so an owner can only ever map onto a
  // member and a number inside the same tenant — a member's channel_id is a bare
  // foreign key, and resolveOwnerTarget only honours it when it is in this list.
  const [users, channels] = await Promise.all([
    listUsers(tenantId).catch(() => []),
    listChannels(tenantId).catch(() => []),
  ]);
  const target = resolveOwnerTarget(ownerEmail, users, channels, { channelId: conv.channelId, platform: conv.platform });
  return applyOwnerTarget(conv, target, changedBy, tenantId);
}

// ── Pull: LeadSquared is the system of record ────────────────────────────────

// Where we remember the owner we last acted on. Only an owner CHANGE moves a
// lead, which is what lets a manual "Hand to Ops" stick: re-reading the same
// unchanged owner must not drag the chat back to sales on the next sweep.
const OWNER_ATTR = "lsq_owner_email";

export interface OwnerSyncOutcome extends HandoverResult {
  checked: boolean;          // we actually reached LeadSquared
  ownerEmail: string | null;
  changed: boolean;          // the CRM owner differs from the one we last saw
}

const idle = (note: string, ownerEmail: string | null = null, checked = true): OwnerSyncOutcome =>
  ({ checked, ownerEmail, changed: false, moved: false, assigned: null, team: null, note });

// Read this lead's owner from LeadSquared and mirror it into the portal.
//
// `force` re-applies the current owner even when it has not changed — what the
// "Sync from LeadSquared" button does, because a person clicking it is asking
// for the CRM's answer now, not for a diff since last time.
export async function syncOwnerFromCrm(
  conv: Pick<Conversation, "id" | "phone" | "assignedTo" | "channelId" | "platform">,
  opts: { force?: boolean; changedBy?: string } = {},
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<OwnerSyncOutcome> {
  if (!await lsqConfigured(tenantId)) return idle("LeadSquared isn't configured", null, false);

  const lead = await fetchLeadDetails(conv.phone, tenantId).catch(() => null);
  if (!lead) return idle("this number isn't in LeadSquared");
  const ownerEmail = lead.ownerEmail;
  if (!ownerEmail) return idle("the lead has no owner in LeadSquared", null);

  const contact = await getContactByPhoneLoose(conv.phone, tenantId).catch(() => null);
  const canonical = contact?.phone ?? conv.phone;
  const seen = (contact?.attributes?.[OWNER_ATTR] ?? "").toLowerCase();

  if (seen === ownerEmail && !opts.force) {
    return idle("LeadSquared owner unchanged", ownerEmail);
  }

  const res = await handToOwner(conv, ownerEmail, opts.changedBy ?? "leadsquared", tenantId);
  // Stamp only after acting, so a failed reassign is retried next sweep rather
  // than being remembered as done.
  await setContactAttributes(canonical, { [OWNER_ATTR]: ownerEmail }, tenantId).catch(() => undefined);
  return { ...res, checked: true, ownerEmail, changed: seen !== ownerEmail };
}

// Same, addressed by phone — the LSQ webhook has a phone, not a conversation.
export async function syncOwnerByPhone(phone: string, ownerEmail: string | null, changedBy = "leadsquared", tenantId: string = DEFAULT_TENANT_ID): Promise<HandoverResult & { found: boolean }> {
  const conv = await getConversationByPhone(phone, tenantId).catch(() => null);
  if (!conv) return { found: false, moved: false, assigned: null, team: null, note: "no conversation yet — the owner is stored and applies once the lead messages" };
  return { found: true, ...(await handToOwner(conv, ownerEmail, changedBy, tenantId)) };
}

// ── Rolling sweep ────────────────────────────────────────────────────────────

// A backstop for the webhook. LSQ automations have to be configured by hand and
// can be switched off without anyone noticing here, so this walks the recently
// active conversations on a cursor and reconciles each one's owner. Cheap by
// design: one LSQ read per conversation, and no writes at all unless the owner
// actually changed.
const SWEEP_EVERY_MS = 10 * 60_000;
const SWEEP_WINDOW_DAYS = 30;

type SweepOutcome = { ran: boolean; checked: number; moved: number; reason?: string };

// One workspace's turn. Everything it reads or writes — the opt-in switch, the
// throttle, the cursor, the conversations, the CRM credentials — is that
// workspace's own.
async function drainCrmOwnerSyncForTenant(tenantId: string, limit: number): Promise<SweepOutcome> {
  if (!await lsqConfigured(tenantId)) return { ran: false, checked: 0, moved: 0, reason: "LeadSquared not configured" };
  // The sweep READS from LSQ but MOVES conversations between teams' inboxes on
  // the strength of it, so a pause has to stop it too.
  if (await lsqPaused(tenantId)) return { ran: false, checked: 0, moved: 0, reason: "paused" };
  if ((await getTenantSetting<boolean>(tenantId, "crm_owner_sync_enabled", false)) !== true) {
    return { ran: false, checked: 0, moved: 0, reason: "disabled" };
  }

  const last = await getTenantSetting<string | null>(tenantId, "crm_owner_sync_at", null);
  if (last && Date.now() - Date.parse(last) < SWEEP_EVERY_MS) return { ran: false, checked: 0, moved: 0, reason: "throttled" };
  await setTenantSetting(tenantId, "crm_owner_sync_at", new Date().toISOString());

  // Descending cursor over last_inbound_at, wrapping when it runs past the
  // window. Without it every tick would re-check the same newest rows forever
  // and the older half of the inbox would never be reconciled.
  const cursor = await getTenantSetting<string | null>(tenantId, "crm_owner_sync_cursor", null);
  const floor = new Date(Date.now() - SWEEP_WINDOW_DAYS * 86_400_000).toISOString();

  let q = db().from("wa_conversations")
    .select("id, phone, assigned_to, channel_id, platform, last_inbound_at")
    .eq("tenant_id", tenantId)
    .not("last_inbound_at", "is", null)
    .gte("last_inbound_at", floor)
    .order("last_inbound_at", { ascending: false })
    .limit(limit);
  if (cursor) q = q.lt("last_inbound_at", cursor);

  const { data, error } = await q;
  if (error) return { ran: true, checked: 0, moved: 0, reason: error.message };
  const rows = (data ?? []) as Record<string, unknown>[];

  // Short page → the window is exhausted; start again from the top next tick.
  await setTenantSetting(tenantId, "crm_owner_sync_cursor", rows.length < limit ? null : (rows[rows.length - 1].last_inbound_at as string));

  let checked = 0, moved = 0;
  for (const r of rows) {
    try {
      const out = await syncOwnerFromCrm({
        id: r.id as string,
        phone: r.phone as string,
        assignedTo: (r.assigned_to as string | null) ?? null,
        channelId: (r.channel_id as string | null) ?? null,
        platform: ((r.platform as string) ?? "whatsapp") as Conversation["platform"],
      }, {}, tenantId);
      if (out.checked) checked++;
      if (out.moved) moved++;
    } catch (e) {
      console.error("[handover] sweep", r.id, e);
    }
  }
  return { ran: true, checked, moved };
}

// The cron entry point: every workspace that has opted in gets its turn, and
// `limit` caps the CONVERSATIONS checked in total so one tick stays cheap no
// matter how many workspaces there are.
export async function drainCrmOwnerSync(limit = 15): Promise<SweepOutcome> {
  // Only the workspaces that switched the sweep on — one query, rather than a
  // LeadSquared-config + pause + setting read for every tenant on every tick
  // (which, inside the cron's shared 45s budget, starves the stages after it).
  let ids: string[];
  try { ids = await tenantIdsWithSetting("crm_owner_sync_enabled", v => v === true); }
  catch (e) { return { ran: false, checked: 0, moved: 0, reason: e instanceof Error ? e.message : String(e) }; }
  if (!ids.length) return { ran: false, checked: 0, moved: 0, reason: "disabled" };
  let ran = false, checked = 0, moved = 0;
  let reason: string | undefined;
  for (const id of ids) {
    if (checked >= limit) break;
    const r = await drainCrmOwnerSyncForTenant(id, limit - checked).catch(e => ({ ran: false, checked: 0, moved: 0, reason: String(e) } as SweepOutcome));
    ran = ran || r.ran; checked += r.checked; moved += r.moved;
    if (!r.ran && !reason) reason = r.reason;
  }
  return { ran, checked, moved, ...(ran ? {} : { reason }) };
}
