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

    void alertIfBadlyStalled(ageMin).catch(() => undefined);

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
async function alertIfBadlyStalled(ageMin: number): Promise<void> {
  if (ageMin < ALERT_MIN) return;
  const to = process.env.ADMIN_USER;
  if (!to) return;

  const sinceAlert = minutesSince(await getSetting<string>(ALERT_KEY, ""));
  if (sinceAlert !== null && sinceAlert < ALERT_THROTTLE_HOURS * 60) return;
  await setSetting(ALERT_KEY, new Date().toISOString());

  const mins = Math.round(ageMin);
  const { html, text } = renderEmail({
    preheader: `Nothing queue-driven has run for ${mins} minutes.`,
    heading: "The background engine has stalled",
    paragraphs: [
      `Talko AI's background engine last completed a pass ${mins} minutes ago. While it's stalled, everything queue-driven is paused: broadcasts, drip sequences, flow reminders, AI follow-ups, comment automation and owner email campaigns.`,
      "Nothing is lost — every queue claims its work atomically and resumes where it left off. But nothing is going out either.",
      "The app tried to restart the engine itself from live traffic before sending this, so if you're reading this, that didn't take. Check the pg_cron job in Supabase first, then the GitHub Actions schedule and CRON_URL.",
    ],
    highlight: "This alert is throttled to once every 6 hours, so it won't flood while the problem persists.",
    cta: { label: "Open the Owner Console", href: "/admin/owner" },
    footerReason: "You're getting this because you're the platform owner (ADMIN_USER) and the background engine stopped running.",
  }, SITE_URL);

  await sendEmail({ to, subject: `Talko AI: background engine stalled (${mins}m)`, html, text, type: "platform_alert" });
}
