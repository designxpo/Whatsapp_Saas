// Stage drips (Phase 6) — auto-enroll leads into a nurture sequence when their
// LeadSquared stage CHANGES. The LSQ→portal webhook (Phase 4) keeps lsq_stage
// fresh on the contact; a transition consults the map below: the new stage's
// sequence starts, and every OTHER stage-managed sequence stops (the lead moved
// on — the old nurture no longer applies). Sequences not in the map are never
// touched. Config in wa_settings (no migration); admin-managed in the
// Sequences tab. Cold leads: make each mapped sequence's step 1 an approved
// template — free-form steps outside Meta's 24h window are skipped by design.

import { getTenantSetting, setTenantSetting } from "./store";
import { DEFAULT_TENANT_ID } from "./tenant";

export interface StageDrip { stage: string; sequenceId: string }

const KEY = "stage_drips";
const norm = (s?: string) => (s ?? "").trim().toLowerCase();

export async function getStageDrips(tenantId: string = DEFAULT_TENANT_ID): Promise<StageDrip[]> {
  const raw = await getTenantSetting<StageDrip[]>(tenantId, KEY, []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(d => d && typeof d.stage === "string" && d.stage.trim() && typeof d.sequenceId === "string" && d.sequenceId)
    .map(d => ({ stage: d.stage.trim(), sequenceId: d.sequenceId }))
    .filter(d => { const k = norm(d.stage); if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function setStageDrips(list: StageDrip[], tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  const seen = new Set<string>();
  const clean = (list ?? [])
    .filter(d => d && d.stage?.trim() && d.sequenceId)
    .map(d => ({ stage: d.stage.trim(), sequenceId: d.sequenceId }))
    .filter(d => { const k = norm(d.stage); if (seen.has(k)) return false; seen.add(k); return true; });
  await setTenantSetting(tenantId, KEY, clean);
}

// Pure decision for a prev→next stage move. Idempotent by design: a replayed
// webhook (same stage again) is a no-op, so LSQ retries can't double-enroll.
// - enroll: the sequence mapped to `next` — unless prev mapped to the SAME
//   sequence (the nurture simply continues; re-enrolling would restart it).
// - stop: every other sequence in the map (deduped, excluding the enroll
//   target). Moving to an UNMAPPED stage stops all stage-managed nurtures.
export function stageTransition(prevStage: string | undefined, nextStage: string, drips: StageDrip[]): { enroll: string | null; stop: string[] } {
  if (!norm(nextStage) || norm(prevStage) === norm(nextStage)) return { enroll: null, stop: [] };
  const target = drips.find(d => norm(d.stage) === norm(nextStage))?.sequenceId ?? null;
  const prevTarget = drips.find(d => norm(d.stage) === norm(prevStage))?.sequenceId ?? null;
  const enroll = target && target !== prevTarget ? target : null;
  const stop = [...new Set(drips.map(d => d.sequenceId))].filter(id => id !== target);
  return { enroll, stop };
}
