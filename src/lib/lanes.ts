import { LANES, Lane, AIDA_STAGES, AidaStage, AIDA_LABELS, isLane, isAidaStage, laneAllows } from "./drip-types";
export { LANES, type Lane, AIDA_STAGES, type AidaStage, AIDA_LABELS, isLane, isAidaStage, laneAllows } from "./drip-types";
import { DEFAULT_TENANT_ID } from "./tenant";
// Which funnel a lead is in, and which number that funnel speaks from.
//
// Marketing and Sales each run a full Attention → Interest → Desire → Action
// journey, on different audiences. A lead is in exactly one lane at a time and
// this file is the ONLY place that decides which — the same discipline
// teams.ts applies to channel scoping, so there is one rule to audit rather
// than one per call site.
//
// There is no handover between the lanes. LeadSquared already owns the moment
// a lead becomes somebody's; all this does is read it.

import { tdb } from "./tenantdb";
import { getContactByPhoneLoose } from "./store";

/** The two lanes that run a funnel. ops has no funnel yet; api has no inbox. */






/** What each stage is FOR, in the words an operator would use. */





/**
 * Which funnel this lead belongs to.
 *
 * A counsellor owns them, or nobody does. That is the whole rule, and it is
 * deliberately the CRM's answer rather than ours: LeadSquared is where a lead
 * is assigned, so anything we inferred separately would disagree with it the
 * first time somebody reassigned a lead in the CRM.
 *
 * `lsq_owner` is stamped on the contact by the LeadSquared webhook. A blank or
 * whitespace value is NOT ownership — an automation that posts an empty owner
 * field would otherwise silently move every lead it touched into the sales
 * lane, where no marketing journey can reach them again.
 *
 * Unreadable contact → marketing, because that is the lane whose journeys are
 * safe to send to a stranger. Guessing sales on a database error would enrol
 * somebody into a counsellor's personal nurture on the strength of a timeout.
 */
export async function leadLane(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<Lane> {
  const contact = await getContactByPhoneLoose(phone, tenantId).catch(() => null);
  const owner = (contact?.attributes?.lsq_owner ?? "").trim();
  return owner ? "sales" : "marketing";
}

/**
 * Does this lead belong in this journey?
 *
 * An UNFILED sequence (no team) is allowed to enrol anybody. Those predate the
 * lanes and refusing them would switch off a working automation on the day this
 * shipped, which is not a migration anybody asked for.
 *
 * An ops or api sequence is likewise unchecked: neither runs a funnel, so there
 * is no lane for them to be wrong about.
 */


export interface LaneSender {
  channelId: string;
  name: string;
  wabaId: string | null;
}

/**
 * The number a lane's journeys send from.
 *
 * Deliberately returns null rather than falling back to the environment's
 * default number. A journey that quietly sends from a number nobody chose is
 * worse than one that refuses to save: the operator sees it working, and the
 * lead sees a stranger's number — while the templates the journey needs are
 * approved somewhere else entirely, so every step past the first is skipped.
 *
 * Several numbers on a team is normal — Sales has ten. The one flagged default
 * wins; failing that the oldest, so the answer is stable rather than whatever
 * Postgres returned first.
 */
export async function laneSender(team: Lane, tenantId = DEFAULT_TENANT_ID): Promise<LaneSender | null> {
  const { data } = await tdb(tenantId)
    .from("wa_channels")
    .select("id,name,waba_id,is_default,created_at")
    .eq("team", team).eq("kind", "whatsapp").eq("active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  const row = (data ?? [])[0] as unknown as { id: string; name: string; waba_id: string | null } | undefined;
  return row ? { channelId: row.id, name: row.name, wabaId: row.waba_id ?? null } : null;
}

/** Why a lane cannot run a journey yet, phrased as the thing to go and do. */
export async function laneProblem(team: Lane, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const sender = await laneSender(team, tenantId);
  if (!sender) {
    return `No WhatsApp number is tagged "${team}". Tag one in Settings → Numbers, or this journey has nothing to send from.`;
  }
  if (!sender.wabaId) {
    return `${sender.name} is tagged "${team}" but has no WhatsApp Business Account on record, so its approved templates cannot be listed.`;
  }
  return null;
}
