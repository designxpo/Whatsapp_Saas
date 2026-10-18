import { DEFAULT_TENANT_ID } from "./tenant";
// The shared machinery behind CRM-driven drips.
//
// A lead in LeadSquared carries two single-valued gradings that counsellors
// move it between, and each one can drive a nurture sequence:
//
//   stage        ProspectStage      New Lead, Enquiry, Hot, Enrolled, …
//   lead score   mx_Lead_Score      Hot, Warm, Cold, Junk  (set by hand)
//
// Stage drips shipped first and this is their logic, lifted out unchanged so
// the score dimension does not get a second, subtly different copy of it. The
// rules are identical because the shape is identical: a lead has exactly one
// value at a time, so moving to a new one means the previous nurture no longer
// applies.
//
// Kept in wa_settings rather than a table — a handful of rows an admin edits,
// with no migration to apply before the feature works.

import { getTenantSetting, setTenantSetting } from "./store";

/** One rule: when the lead lands on `value`, run `sequenceId`. */
export interface DripRule { value: string; sequenceId: string }

export const norm = (s?: string) => (s ?? "").trim().toLowerCase();

/** Drop malformed rules, and keep only the FIRST rule for each value. */
export function cleanRules(list: DripRule[] | unknown): DripRule[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return (list as DripRule[])
    .filter(d => d && typeof d.value === "string" && d.value.trim() && typeof d.sequenceId === "string" && d.sequenceId)
    .map(d => ({ value: d.value.trim(), sequenceId: d.sequenceId }))
    .filter(d => { const k = norm(d.value); if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function getRules(key: string, tenantId = DEFAULT_TENANT_ID): Promise<DripRule[]> {
  return cleanRules(await getTenantSetting<DripRule[]>(tenantId, key, []));
}

export async function setRules(key: string, list: DripRule[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await setTenantSetting(tenantId, key, cleanRules(list));
}

/**
 * What a prev -> next move should do. Pure.
 *
 * Idempotent by design: the same value again is a no-op, so a webhook
 * LeadSquared retries cannot enrol the lead twice.
 *
 *  - enroll: the sequence mapped to `next` — unless `prev` mapped to the SAME
 *    sequence, in which case the nurture simply continues and re-enrolling
 *    would restart it from step one.
 *  - stop: every other sequence in the map. Moving to a value nobody mapped
 *    stops all of them, which is the point: the lead has moved on.
 */
export function ruleTransition(prev: string | undefined, next: string, rules: DripRule[]): { enroll: string | null; stop: string[] } {
  if (!norm(next) || norm(prev) === norm(next)) return { enroll: null, stop: [] };
  const target = rules.find(d => norm(d.value) === norm(next))?.sequenceId ?? null;
  const prevTarget = rules.find(d => norm(d.value) === norm(prev))?.sequenceId ?? null;
  const enroll = target && target !== prevTarget ? target : null;
  const stop = [...new Set(rules.map(d => d.sequenceId))].filter(id => id !== target);
  return { enroll, stop };
}
