// Self-healing for the background engine.
//
// The problem this exists to solve: the queue engine is driven by a GitHub
// Actions `*/5` schedule, and GitHub's scheduler is explicitly best-effort —
// their own docs say the schedule event "can be delayed during periods of high
// loads" and "some queued jobs may be dropped". In practice this repo's job has
// been firing every 3-6 HOURS instead of every 5 minutes, repeatedly, which
// stops everything queue-driven: broadcasts, drip sequences, flow reminders,
// AI follow-ups, comment automation, owner email campaigns.
//
// So the engine no longer depends on any single clock. Three layers, in order of
// how much we trust them:
//
//   1. pg_cron inside Supabase (migration 0116) — the primary. Runs in the same
//      database the app already depends on, so it is up whenever the app is.
//   2. The GitHub Actions schedule — kept because it costs nothing and
//      occasionally works. All cron work is idempotent, so overlap is safe.
//   3. THIS: real inbound traffic as a clock. Any customer message or admin
//      page load notices a stale heartbeat and kicks the engine. It means that
//      even with every external scheduler dead, an app in active use heals
//      itself — and one nobody is using has nothing urgent to drain anyway.
//
// Plus an alert, so a long stall is never again something you find out about by
// happening to look at the dashboard.

import { getSetting, setSetting } from "./store";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { SITE_URL } from "./siteurl";

// Kick once the heartbeat is this old: two missed ticks of the five-minute
// schedule, and still inside publicstatus.ts's 20-minute "operational" window,
// so the engine heals itself before the status page ever goes amber.
const STALE_MIN = 12;
/** Never kick more often than this, however much traffic arrives. */
const KICK_THROTTLE_MIN = 3;
/** Email the owner past this — something is wrong with every scheduler. */
const ALERT_MIN = 45;
/** And at most this often, so an ongoing outage doesn't become an inbox flood. */
const ALERT_THROTTLE_HOURS = 6;
/**
 * How long a kick gets to land before we judge whether it worked.
 *
 * The engine's own run takes a while; alerting two seconds after firing the
 * request that fixes the problem is how this ended up emailing the owner every
 * six hours about an outage that had already resolved itself.
 */
const KICK_GRACE_MIN = 5;

const KICK_KEY = "cron_kick_at";
const ALERT_KEY = "cron_alert_at";

const minutesSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 60_000 : null;
};

export type KickDecision = "fresh" | "throttled" | "kick";

/**
 * The whole threshold policy, as one pure function — the part worth testing,
 * since getting it wrong in either direction is bad: too eager and every
 * webhook spawns an engine run, too lax and a stall goes unhealed.
 *
 * `heartbeatAgeMin` / `lastKickAgeMin` are null when the setting has never been
 * written (a fresh database), which is NOT a stall — there is nothing queued on
 * a deployment that has never ticked.
 */
export function decideKick(heartbeatAgeMin: number | null, lastKickAgeMin: number | null): KickDecision {
  if (heartbeatAgeMin === null || heartbeatAgeMin < STALE_MIN) return "fresh";
  if (lastKickAgeMin !== null && lastKickAgeMin < KICK_THROTTLE_MIN) return "throttled";
  return "kick";
}

/**
 * Whether a stall is worth waking a human for.
 *
 * The original rule — "heartbeat older than ALERT_MIN" — produced a genuinely
 * misleading alert on this fleet, and it is worth spelling out why, because the
 * shape of the mistake recurs.
 *
 * The watchdog runs on inbound traffic. On a quiet fleet hours pass with no
 * request at all, so the FIRST request of the morning legitimately finds a
 * 50-minute-old heartbeat. That request kicks the engine — and under the old
 * rule also emailed the owner to say the engine was down. It was reporting a
 * problem it was in the middle of fixing, every six hours, for days. The
 * emails were accurate about the heartbeat and completely wrong about the
 * situation, which is the worst kind of alert: it trains you to ignore it.
 *
 * A stall is only real if a kick has already been given time to land and the
 * heartbeat is STILL older than that kick — meaning the engine never ticked in
 * response. That is the condition no amount of traffic will fix on its own.
 */
export function decideAlert(
  heartbeatAgeMin: number,
  lastKickAgeMin: number | null,
  lastAlertAgeMin: number | null,
): boolean {
  if (heartbeatAgeMin < ALERT_MIN) return false;
  // Never alert on a first detection — that request is about to kick it.
  if (lastKickAgeMin === null) return false;
  // Don't judge a kick that hasn't had time to complete.
  if (lastKickAgeMin < KICK_GRACE_MIN) return false;
  // The heartbeat being NEWER than our last kick means the kick worked.
  // Only a heartbeat that still predates it shows the engine never responded.
  if (heartbeatAgeMin <= lastKickAgeMin) return false;
  if (lastAlertAgeMin !== null && lastAlertAgeMin < ALERT_THROTTLE_HOURS * 60) return false;
  return true;
}

/**
 * Called from real traffic. Cheap on the happy path: one settings read, then
 * returns. NEVER throws — a webhook must not fail because the watchdog did.
 *
 * Returns what it decided, for logging/tests.
 */
export async function kickIfStalled(source: string): Promise<"fresh" | "throttled" | "kicked" | "unconfigured" | "error"> {
  try {
    const ageMin = minutesSince(await getSetting<string>("cron_last_tick", ""));
    // Narrowed here rather than trusting decideKick's verdict to imply it —
    // TypeScript can't see through the helper, and everything below genuinely
    // needs a number (the alert body, the log lines).
    if (ageMin === null || decideKick(ageMin, null) === "fresh") return "fresh";

    // Throttle. Two concurrent requests can both read a stale value here and
    // both kick — deliberately tolerated rather than adding a DB function for
    // it: every drain the engine runs claims its own rows atomically
    // (claim_send_queue, claim_owner_email_queue, the flow-session CAS), so a
    // duplicate tick sends nothing twice. It just costs one wasted invocation.
    const sinceKick = minutesSince(await getSetting<string>(KICK_KEY, ""));
    if (decideKick(ageMin, sinceKick) === "throttled") return "throttled";
    await setSetting(KICK_KEY, new Date().toISOString());

    void alertIfBadlyStalled(ageMin, sinceKick).catch(() => undefined);

    const secret = process.env.CRON_SECRET;
    const base = (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL || "").replace(/\/$/, "");
    if (!secret || !base) {
      console.error(`[cronwatchdog] heartbeat ${Math.round(ageMin)}m stale but CRON_SECRET/site URL not configured — cannot self-kick`);
      return "unconfigured";
    }

    console.warn(`[cronwatchdog] heartbeat ${Math.round(ageMin)}m stale — kicking the engine (via ${source})`);
    // Fire and forget on purpose: this runs inside someone else's request (a
    // webhook, a page load) and must not delay it. The engine's own endpoint
    // gets its own invocation and its own 300s budget. AbortSignal so a hung
    // connection can't hold this open either.
    void fetch(`${base}/api/cron/process-queue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000),   // we only need it STARTED, not finished
    }).catch(() => undefined);

    return "kicked";
  } catch (e) {
    console.error("[cronwatchdog] watchdog itself failed (ignored):", e instanceof Error ? e.message : e);
    return "error";
  }
}

// One email to the platform owner when the engine has been down long enough
// that all three clocks have clearly failed. Throttled hard — an outage that
// lasts a day should produce a handful of emails, not hundreds.
async function alertIfBadlyStalled(ageMin: number, lastKickAgeMin: number | null): Promise<void> {
  // An explicit off switch, because an operator who has decided to live with a
  // flaky scheduler should be able to say so once rather than filtering mail.
  // Off means OFF — the Owner Console still shows the engine's real state.
  if ((process.env.PLATFORM_ALERT_EMAILS ?? "").toLowerCase() === "off") return;
  const to = process.env.ADMIN_USER;
  if (!to) return;

  const sinceAlert = minutesSince(await getSetting<string>(ALERT_KEY, ""));
  if (!decideAlert(ageMin, lastKickAgeMin, sinceAlert)) return;
  await setSetting(ALERT_KEY, new Date().toISOString());

  const mins = Math.round(ageMin);
  const { html, text } = renderEmail({
    preheader: `Nothing queue-driven has run for ${mins} minutes.`,
    heading: "The background engine has stalled",
    paragraphs: [
      `Talko AI's background engine last completed a pass ${mins} minutes ago. While it's stalled, everything queue-driven is paused: broadcasts, drip sequences, flow reminders, AI follow-ups, comment automation and owner email campaigns.`,
      "Nothing is lost — every queue claims its work atomically and resumes where it left off. But nothing is going out either.",
      "This is not a first sighting: the app already restarted the engine from live traffic, gave it time to respond, and the heartbeat still predates that attempt. Something is wrong with the engine itself, not just its schedule. Check the pg_cron job in Supabase first, then the GitHub Actions schedule and CRON_URL.",
    ],
    highlight: "Throttled to once every 6 hours. Set PLATFORM_ALERT_EMAILS=off to stop these entirely.",
    cta: { label: "Open the Owner Console", href: "/admin/owner" },
    footerReason: "You're getting this because you're the platform owner (ADMIN_USER) and the background engine stopped running.",
  }, SITE_URL);

  await sendEmail({ to, subject: `Talko AI: background engine stalled (${mins}m)`, html, text, type: "platform_alert" });
}
