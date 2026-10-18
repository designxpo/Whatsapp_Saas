import { DEFAULT_TENANT_ID } from "./tenant";
// Stage drips (Phase 6) — auto-enroll leads into a nurture sequence when their
// LeadSquared stage CHANGES. The LSQ→portal webhook (Phase 4) keeps lsq_stage
// fresh on the contact; a transition consults the map below: the new stage's
// sequence starts, and every OTHER stage-managed sequence stops (the lead moved
// on — the old nurture no longer applies). Sequences not in the map are never
// touched. Config in wa_settings (no migration); admin-managed in the
// Sequences tab. Cold leads: make each mapped sequence's step 1 an approved
// template — free-form steps outside Meta's 24h window are skipped by design.
//
// The decision itself now lives in crmdrips.ts, because lead-score drips need
// exactly the same rules and a second copy of them would drift. This file is
// the stage-shaped face of it and its behaviour is unchanged — stagedrips.test
// .ts is the evidence, and it was not touched when the logic moved.

import { getRules, setRules, ruleTransition, type DripRule } from "./crmdrips";

export interface StageDrip { stage: string; sequenceId: string }

const KEY = "stage_drips";

const toRule = (d: StageDrip): DripRule => ({ value: d.stage, sequenceId: d.sequenceId });
const toStage = (r: DripRule): StageDrip => ({ stage: r.value, sequenceId: r.sequenceId });

export async function getStageDrips(tenantId = DEFAULT_TENANT_ID): Promise<StageDrip[]> {
  return (await getRules(KEY, tenantId)).map(toStage);
}

export async function setStageDrips(list: StageDrip[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await setRules(KEY, (list ?? []).map(toRule), tenantId);
}

// Pure decision for a prev→next stage move. Idempotent by design: a replayed
// webhook (same stage again) is a no-op, so LSQ retries can't double-enroll.
export function stageTransition(prevStage: string | undefined, nextStage: string, drips: StageDrip[]): { enroll: string | null; stop: string[] } {
  return ruleTransition(prevStage, nextStage, (drips ?? []).map(toRule));
}
