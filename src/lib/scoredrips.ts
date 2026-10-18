import { KNOWN_SCORES } from "./drip-types";
export { KNOWN_SCORES } from "./drip-types";
import { DEFAULT_TENANT_ID } from "./tenant";
// Lead-score drips — start a nurture sequence when a counsellor grades a lead
// in LeadSquared.
//
// Stage drips already did this for ProspectStage, which moves as the lead
// progresses. This is the other grading: mx_Lead_Score, a dropdown a person
// sets by hand on the call — Hot, Warm, Cold, Junk in this account. The two
// are used for different things, so both drive drips and both are configured
// separately.
//
// Same rules as stage drips, because the shape is the same: a lead holds one
// score at a time, so being re-graded means the previous nurture no longer
// applies. The decision lives in crmdrips.ts and is shared, not copied.
//
// ── Why this is the one that most needs templates ───────────────────────────
//
// A counsellor grading a lead Hot is almost never doing it inside the 24-hour
// window — they are working a list, hours or days after the lead last wrote.
// So step 1 of a score-driven sequence must be an approved template or it is
// skipped on arrival, silently, and the drip looks switched off. The sequence
// editor now warns about this per step; it is worth saying twice.

import { getRules, setRules, ruleTransition, type DripRule } from "./crmdrips";

export interface ScoreDrip { score: string; sequenceId: string }

const KEY = "lead_score_drips";

const toRule = (d: ScoreDrip): DripRule => ({ value: d.score, sequenceId: d.sequenceId });
const toScore = (r: DripRule): ScoreDrip => ({ score: r.value, sequenceId: r.sequenceId });

export async function getScoreDrips(tenantId = DEFAULT_TENANT_ID): Promise<ScoreDrip[]> {
  return (await getRules(KEY, tenantId)).map(toScore);
}

export async function setScoreDrips(list: ScoreDrip[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await setRules(KEY, (list ?? []).map(toRule), tenantId);
}

/**
 * What a re-grading should do. Pure, and idempotent on a replayed webhook.
 *
 * Separate from stageTransition despite sharing an implementation, so a
 * caller cannot accidentally hand a stage map to a score change: the two are
 * configured independently and mixing them would enrol a lead into somebody
 * else's nurture.
 */
export function scoreTransition(prevScore: string | undefined, nextScore: string, drips: ScoreDrip[]): { enroll: string | null; stop: string[] } {
  return ruleTransition(prevScore, nextScore, (drips ?? []).map(toRule));
}

/**
 * The values this LeadSquared account offers, for the picker.
 *
 * Hard-coded rather than fetched: the options come from LeadsMetaData.Get,
 * which is a network call on a settings screen, and a dropdown that is empty
 * because the CRM was slow is worse than one that is occasionally out of date.
 * Anything typed in is still accepted, so a fifth grade added in LeadSquared
 * does not need a deploy here.
 */

