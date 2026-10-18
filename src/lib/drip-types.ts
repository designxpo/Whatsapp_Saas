export const LANES = ["marketing", "sales"] as const;
export type Lane = (typeof LANES)[number];
export const AIDA_STAGES = ["attention", "interest", "desire", "action", "retention"] as const;
export type AidaStage = (typeof AIDA_STAGES)[number];
export const AIDA_LABELS: Record<AidaStage, { label: string; job: string }> = {
  attention: { label: "Attention", job: "Get a stranger to start a conversation." },
  interest:  { label: "Interest",  job: "Hold them — answer the question they actually came with." },
  desire:    { label: "Desire",    job: "Make them want it. Proof, outcomes, alumni, scarcity." },
  action:    { label: "Action",    job: "Ask for the decision — book the call, take the seat." },
  retention: { label: "Retention", job: "After they join: onboarding, referrals, the next course." },
};
export const isLane = (v: unknown): v is Lane => typeof v === "string" && (LANES as readonly string[]).includes(v);
export const isAidaStage = (v: unknown): v is AidaStage =>
  typeof v === "string" && (AIDA_STAGES as readonly string[]).includes(v);
export function laneAllows(sequenceTeam: string | null | undefined, lane: Lane): boolean {
  if (!isLane(sequenceTeam)) return true;
  return sequenceTeam === lane;
}
export const KNOWN_SCORES = ["Hot", "Warm", "Cold", "Junk"] as const;
