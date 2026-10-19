// Per-stage liveness for the background engine.
//
// The engine's heartbeat (cron_last_tick) only proves the ROUTE runs. It said
// nothing when a deploy pushed the route's later stages past their shared time
// budget: from 2026-10-18 the heartbeat stayed green while YouTube comments,
// Google reviews and URL re-sync silently never ran again. Nothing failed, so
// nothing logged — a skipped stage simply didn't happen.
//
// So every stage now reports whether it got its turn, and a stage that hasn't
// had one for STALE_MIN while the engine itself is ticking is called out: in
// the logs every tick, and to the platform owner by email (throttled).

import { getSetting, setSetting } from "./store";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { SITE_URL } from "./siteurl";

/** A stage that hasn't run for this long, on an engine that is ticking, is starved. */
export const STALE_MIN = 30;
const ALERT_THROTTLE_HOURS = 6;
const RUNS_KEY = "cron_stage_runs";
const ALERT_KEY = "cron_stage_alert_at";

export interface StageRuns {
  /** When tracking started — a stage never seen since then has never run. */
  since: string;
  /** Stage name → last time it got its turn. */
  runs: Record<string, string>;
  /** The latest tick: how long each stage took (ms), and which got no turn. */
  lastTick?: { at: string; tookMs: Record<string, number>; skipped: string[] };
}

export interface StarvedStage { stage: string; minutes: number }

/**
 * Merge this tick's runs into the record. Pure.
 */
export function mergeRuns(prev: StageRuns | null, ran: string[], now: Date): StageRuns {
  const at = now.toISOString();
  const runs = { ...(prev?.runs ?? {}) };
  for (const s of ran) runs[s] = at;
  return { since: prev?.since ?? at, runs };
}

/**
 * Which expected stages have gone STALE_MIN without a turn. Pure — the policy
 * worth testing. A stage never recorded counts from when tracking began, so a
 * deploy that starves a stage from its very first tick is still caught.
 */
export function starvedStages(rec: StageRuns, expected: string[], now: Date): StarvedStage[] {
  const out: StarvedStage[] = [];
  for (const stage of expected) {
    const t = Date.parse(rec.runs[stage] ?? rec.since);
    if (!Number.isFinite(t)) continue;
    const minutes = Math.round((now.getTime() - t) / 60_000);
    if (minutes >= STALE_MIN) out.push({ stage, minutes });
  }
  return out;
}

/**
 * Record a tick and report starved stages. Never throws — bookkeeping must not
 * fail the engine. Overlapping ticks may lose one stamp to a read-modify-write
 * race; the next tick restamps it, which is far inside STALE_MIN.
 */
export async function recordStageTick(ran: string[], expected: string[], tookMs: Record<string, number> = {}): Promise<StarvedStage[]> {
  try {
    const now = new Date();
    const rec = mergeRuns(await getSetting<StageRuns | null>(RUNS_KEY, null), ran, now);
    // Which stage ate the budget is the first question when one is starved —
    // keep the answer next to the symptom.
    rec.lastTick = { at: now.toISOString(), tookMs, skipped: expected.filter(s => !ran.includes(s)) };
    await setSetting(RUNS_KEY, rec);
    const starved = starvedStages(rec, expected, now);
    if (starved.length) {
      console.error(JSON.stringify({ tag: "cron_stage_starved", starved, note: "These stages are not getting a turn inside the cron's time budget — an earlier stage is too slow." }));
      void alertOwner(starved).catch(() => undefined);
    }
    return starved;
  } catch (e) {
    console.error("[cronstages] bookkeeping failed (ignored):", e instanceof Error ? e.message : e);
    return [];
  }
}

async function alertOwner(starved: StarvedStage[]): Promise<void> {
  if ((process.env.PLATFORM_ALERT_EMAILS ?? "").toLowerCase() === "off") return;
  const to = process.env.ADMIN_USER;
  if (!to) return;
  const last = Date.parse(await getSetting<string>(ALERT_KEY, ""));
  if (Number.isFinite(last) && Date.now() - last < ALERT_THROTTLE_HOURS * 3_600_000) return;
  await setSetting(ALERT_KEY, new Date().toISOString());

  const list = starved.map(s => `${s.stage} (${s.minutes >= 120 ? `${Math.round(s.minutes / 60)}h` : `${s.minutes}m`})`).join(", ");
  const { html, text } = renderEmail({
    preheader: `${starved.length} background job${starved.length === 1 ? "" : "s"} stopped getting a turn.`,
    heading: "Part of the background engine isn't running",
    paragraphs: [
      `The engine is ticking, but these jobs haven't had a turn: ${list}.`,
      "Each tick shares one time budget, and anything left when it runs out is skipped. Usually an earlier job became slow — often after a deploy that added work to every tick.",
      "Nothing is lost, but whatever these jobs do (comment replies, review replies, re-syncs, emails) is not happening until it's fixed.",
    ],
    highlight: "Throttled to once every 6 hours. Set PLATFORM_ALERT_EMAILS=off to stop these entirely.",
    cta: { label: "Open the Owner Console", href: "/admin/owner" },
    footerReason: "You're getting this because you're the platform owner (ADMIN_USER) and part of the background engine stopped running.",
  }, SITE_URL);
  await sendEmail({ to, subject: `Talko AI: background jobs not running — ${starved.map(s => s.stage).join(", ")}`, html, text, type: "platform_alert" });
}
