import { DEFAULT_TENANT_ID } from "./tenant";
// Starting the stage drip without a LeadSquared Automation.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// The stage drip is supposed to begin when a counsellor moves a lead to the
// hand-off stage. We learn that from a webhook, which requires an Automation
// configured inside LeadSquared — and LeadSquared has no API for creating one.
// It is UI-only. So the feature sat finished and unused from 1 October with
// zero enrolments, waiting on somebody else's console.
//
// This asks instead of waiting: every pass, "which leads are on the hand-off
// stage and were modified since I last looked?" Each answer goes through
// applyLsqLead — the SAME function the webhook calls — so the two paths cannot
// diverge, and running both at once is harmless.
//
// ── Why polling is safe here, specifically ──────────────────────────────────
//
// It is safe because the work is idempotent twice over. applyLsqLead enrols
// only on a stage that DIFFERS from the one stored on the contact, and the
// watermark means a lead is normally only looked at once anyway. Either guard
// alone would do; both means a bug in one does not send anybody a message
// twice.
//
// ── The thing that would actually go wrong ──────────────────────────────────
//
// Not duplicates — volume. There are around a thousand leads already sitting
// on "Not Reachable". A bulk import, a list re-assignment, or somebody fixing
// data in LeadSquared can move hundreds of leads onto a stage in one action,
// and the naive sweep answers by sending hundreds of marketing templates in a
// few minutes. Meta's per-recipient frequency cap is real (observed live on
// 7 October), and a burst like that is exactly how a number's quality rating
// gets destroyed.
//
// So there are three rails:
//
//   1. SEEDING. The first pass enrols nobody. It records the clock and stops,
//      so the existing population is treated as already-seen. Leads only
//      count from the moment the poll was switched on.
//   2. A PER-PASS CAP. At most `maxPerRun` leads are applied in one pass, and
//      the watermark advances only to the last one actually applied. A
//      backlog drains at a known rate over following passes instead of
//      arriving at once — and nothing is lost.
//   3. A BURST ALARM. When a pass sees more candidates than `burstAlarm`, it
//      says so at error level with the count. It still drains, because
//      stopping would strand the queue silently, but a human can see it.
import { getTenantSetting, setTenantSetting, getContactByPhoneLoose } from "./store";
import { leadsOnStageSince, lsqPaused, lsqConfigured } from "./leadsquared";
import { applyLsqLead } from "./lsqapply";
import { getStageDrips, stageTransition } from "./stagedrips";

export const STAGE_POLL_KEY = "lsq_stage_poll";

/** What one lead would have caused, had the poll been applying. */
export interface Observation {
  phone: string;          // masked
  stage: string | null;
  knownStage: string | null;
  wouldEnroll: string | null;
  note: string;
}

export interface StagePoll {
  /** Off by default. Nothing reads LeadSquared until somebody turns this on. */
  enabled: boolean;
  /**
   * observe = read and report what WOULD happen, change nothing.
   * apply   = actually do it.
   *
   * Defaulting to observe is not timidity, it is the only way to try this
   * honestly. An empty stage_drips map already stops any message going out,
   * but applyLsqLead also syncs the lead OWNER — and syncOwnerByPhone moves a
   * live conversation onto another counsellor's number, which is a visible
   * change to somebody's inbox that no "nothing will send" promise covers.
   *
   * So the first run of a new stage is a dry run against real data: it proves
   * the read, the matching and the decision, and touches nothing.
   */
  mode: "observe" | "apply";
  /** The LeadSquared stage that hands a lead to the drip, e.g. "Not Reachable". */
  stage: string;
  /** ISO time of the newest lead change already applied. null = never run. */
  watermark: string | null;
  /** Most leads applied in one pass. */
  maxPerRun: number;
  /** Candidates in one pass above which something is probably wrong. */
  burstAlarm: number;
  lastRunAt?: string;
  lastApplied?: number;
  lastError?: string;
  /**
   * What the last observe pass saw.
   *
   * Stored rather than only logged, because the entire point of observe mode
   * is for somebody to READ it before deciding to apply — and the people who
   * need to read it do not have access to the deployment's logs. A dry run
   * nobody can see is not a dry run.
   */
  lastObserved?: Observation[];
  lastCandidates?: number;
}

const DEFAULTS: StagePoll = {
  enabled: false,
  mode: "observe",
  stage: "",
  watermark: null,
  maxPerRun: 50,
  burstAlarm: 200,
};

/**
 * How far back each pass re-reads, on top of the watermark.
 *
 * LeadSquared's clock is not ours, and ModifiedOn has second resolution. A
 * lead modified in the same second the watermark was written would otherwise
 * fall through the gap and never be seen again. Re-reading two minutes costs
 * nothing — those leads are no-ops on the stage comparison — and closes it.
 */
const OVERLAP_MS = 2 * 60_000;

export async function getStagePoll(tenantId = DEFAULT_TENANT_ID): Promise<StagePoll> {
  const raw = await getTenantSetting<Partial<StagePoll>>(tenantId, STAGE_POLL_KEY, {});
  return {
    ...DEFAULTS,
    ...raw,
    // A zero or a negative read from the settings row would mean "apply
    // nothing, forever" or "apply everything at once". Neither is a setting
    // anybody means to choose, so they fall back rather than being honoured.
    maxPerRun: Number(raw?.maxPerRun) > 0 ? Number(raw.maxPerRun) : DEFAULTS.maxPerRun,
    burstAlarm: Number(raw?.burstAlarm) > 0 ? Number(raw.burstAlarm) : DEFAULTS.burstAlarm,
    stage: String(raw?.stage ?? "").trim(),
    // Anything that is not literally "apply" observes. A typo must not be the
    // thing that starts writing to live conversations.
    mode: raw?.mode === "apply" ? "apply" : "observe",
  };
}

export async function setStagePoll(patch: Partial<StagePoll>, tenantId = DEFAULT_TENANT_ID): Promise<StagePoll> {
  const next = { ...(await getStagePoll(tenantId)), ...patch };
  await setTenantSetting(tenantId, STAGE_POLL_KEY, next);
  return next;
}

export interface StagePollRun {
  ran: boolean;
  mode?: "observe" | "apply";
  observed?: Observation[];
  reason?: string;
  seeded?: boolean;
  candidates?: number;
  applied?: number;
  enrolled?: number;
  scanned?: number;
  burst?: boolean;
  watermark?: string | null;
  error?: string;
}

/**
 * One pass. Never throws — the cron drains twenty other queues after it.
 *
 * `now` is injectable so the tests can place the watermark precisely instead
 * of racing a real clock.
 */
export async function runStagePoll(opts: { now?: Date } = {}, tenantId = DEFAULT_TENANT_ID): Promise<StagePollRun> {
  const now = opts.now ?? new Date();
  const cfg = await getStagePoll(tenantId);

  if (!cfg.enabled) return { ran: false, reason: "disabled" };
  if (!cfg.stage) return { ran: false, reason: "no stage configured" };
  if (!await lsqConfigured(tenantId)) return { ran: false, reason: "LeadSquared isn't configured" };
  // The pause switch means "stop touching LeadSquared". Reading is touching.
  if (await lsqPaused(tenantId)) return { ran: false, reason: "LeadSquared sync is paused" };

  // ── Rail 1: the first pass enrols nobody ──────────────────────────────────
  //
  // Without this, switching the poll on would treat every lead already parked
  // on the stage as having just arrived there.
  if (!cfg.watermark) {
    const at = now.toISOString();
    await setStagePoll({ watermark: at, lastRunAt: at, lastApplied: 0, lastError: undefined }, tenantId);
    console.log(JSON.stringify({ tag: "lsq_stage_poll", seeded: true, stage: cfg.stage, watermark: at }));
    return { ran: true, seeded: true, applied: 0, enrolled: 0, watermark: at };
  }

  const sinceMs = Date.parse(cfg.watermark) - OVERLAP_MS;
  const res = await leadsOnStageSince(cfg.stage, sinceMs, Math.max(cfg.maxPerRun, cfg.burstAlarm), tenantId);
  if (res.error) {
    await setStagePoll({ lastRunAt: now.toISOString(), lastError: res.error }, tenantId);
    return { ran: true, scanned: res.scanned, error: res.error, watermark: cfg.watermark };
  }

  const candidates = res.changed.length;

  // ── Rail 3: say so when a pass is unusually large ─────────────────────────
  const burst = candidates >= cfg.burstAlarm;
  if (burst) {
    console.error(JSON.stringify({
      tag: "lsq_stage_poll", burst: true, stage: cfg.stage, candidates,
      note: `${candidates} leads changed on "${cfg.stage}" since ${cfg.watermark}. Draining at ${cfg.maxPerRun} per pass — check for a bulk update in LeadSquared.`,
    }));
  }

  // ── Rail 2: cap the pass, and move the watermark only as far as we got ────
  const batch = res.changed.slice(0, cfg.maxPerRun);
  let applied = 0, enrolled = 0;
  let highWater = Date.parse(cfg.watermark);

  // ── observe: say what would happen, do none of it ─────────────────────────
  if (cfg.mode !== "apply") {
    const drips = await getStageDrips(tenantId);
    const observed: Observation[] = [];
    for (const { ev, modifiedAt } of batch) {
      const known = await getContactByPhoneLoose(ev.phone ?? "", tenantId).catch(() => null);
      const knownStage = (known?.attributes?.lsq_stage as string | undefined) ?? null;
      const t = ev.stage && ev.stage !== knownStage ? stageTransition(knownStage ?? undefined, ev.stage, drips) : null;
      observed.push({
        phone: `…${String(ev.phone).slice(-4)}`,
        stage: ev.stage,
        knownStage,
        wouldEnroll: t?.enroll ?? null,
        note: !known ? "no contact here yet — would be created"
          : ev.stage === knownStage ? "already on this stage — no change"
          : t?.enroll ? "would start the drip"
          : "stage change recorded, no rule matches this stage",
      });
      if (modifiedAt > highWater) highWater = modifiedAt;
    }
    const nextWatermark = new Date(candidates ? highWater : now.getTime()).toISOString();
    await setStagePoll({
      watermark: nextWatermark, lastRunAt: now.toISOString(), lastApplied: 0, lastError: undefined,
      lastObserved: observed.slice(0, 25), lastCandidates: candidates,
    }, tenantId);
    console.log(JSON.stringify({ tag: "lsq_stage_poll", mode: "observe", stage: cfg.stage, candidates, observed: observed.length }));
    return { ran: true, mode: "observe", candidates, applied: 0, enrolled: 0, scanned: res.scanned, observed, ...(burst ? { burst } : {}), watermark: nextWatermark };
  }

  for (const { ev, modifiedAt } of batch) {
    try {
      const r = await applyLsqLead(ev, { allowWelcome: false }, tenantId);
      if (r.handled) {
        applied++;
        if (r.drip?.enrolled) enrolled++;
      }
    } catch (e) {
      // One bad lead must not strand the rest of the batch, nor the
      // watermark: it is logged and the pass carries on past it. A lead that
      // fails every time would otherwise block the queue for all the others.
      console.error("[lsq_stage_poll] lead failed", e);
    }
    // Advanced whether or not the apply succeeded, deliberately. A lead that
    // throws on every attempt would hold the watermark still and have the
    // whole queue behind it re-read forever.
    if (modifiedAt > highWater) highWater = modifiedAt;
  }

  // Nothing applied and nothing seen: still move up to now, or a quiet period
  // makes every later pass re-read the same empty window.
  const nextWatermark = new Date(candidates ? highWater : now.getTime()).toISOString();
  await setStagePoll({
    watermark: nextWatermark,
    lastRunAt: now.toISOString(),
    lastApplied: applied,
    lastError: undefined,
  }, tenantId);

  if (applied) {
    console.log(JSON.stringify({
      tag: "lsq_stage_poll", stage: cfg.stage, candidates, applied, enrolled,
      scanned: res.scanned, watermark: nextWatermark,
    }));
  }

  return {
    ran: true, mode: "apply", candidates, applied, enrolled, scanned: res.scanned,
    ...(burst ? { burst } : {}),
    watermark: nextWatermark,
  };
}
