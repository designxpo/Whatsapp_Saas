// Meta's application-level rate limit, watched from the responses we already get.
//
// On 23 Oct the company deployment's Meta app reached 100% of that limit and
// Meta blocked it, after a week at 60–95% that nothing on screen showed. This
// app is a different one, but the limit works the same way: 200 calls × daily
// active users per rolling hour — a few hundred for an app that works through
// system users — shared by every workspace connected through it.
//
// Meta reports the figure itself, as the X-App-Usage header, on every response
// that counts toward it. instrumentation.ts hands every Meta response here, so
// watching costs no calls and covers call sites nobody remembered to wire up.
// The reading is:
//
//   • kept in memory for this instance, and written to a platform setting at
//     most once a minute — or at once when it crosses the pause line, so every
//     instance learns of it;
//   • emailed to the platform owner at PAUSE_AT (drainMetaUsageAlert, from
//     the cron), at most once every 6 hours — the same rules as the stalled-
//     engine alert in cronwatchdog.ts;
//   • the gate for background Meta work (metaBackgroundAllowed): at PAUSE_AT
//     the work nobody is waiting on should stop, so customer messages keep the
//     headroom. Any background job that calls Meta should check it.
//
// A reading over an hour old is treated as unknown. The limit is a rolling
// hour, so whatever it said has drained since.

// getSetting/setSetting are pinned to the default tenant here (store.ts), which
// is exactly what a value about the whole deployment needs.
import { getSetting as getPlatformSetting, setSetting as setPlatformSetting } from "./store";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { SITE_URL } from "./siteurl";

export const WARN_AT = 60;
export const PAUSE_AT = 85;
const KEY = "meta_app_usage";
const PERSIST_EVERY_MS = 60_000;
const STALE_MS = 60 * 60_000;
const META_HOSTS = new Set(["graph.facebook.com", "graph.instagram.com"]);

export interface MetaUsage { pct: number; at: string }

let latest: MetaUsage | null = null;
let lastPersistAt = 0;
let lastPersistedPct = -1;

/** Highest of call_count / total_time / total_cputime, or null when the response did not count. */
export function parseUsage(headers: Headers): number | null {
  const raw = headers.get("x-app-usage");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const nums = ["call_count", "total_time", "total_cputime"].map(k => Number(j[k])).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : null;
  } catch {
    return null;
  }
}

/** Called for every server-side fetch response. Never throws. */
export function observeMetaResponse(url: string | URL, res: Pick<Response, "headers">, now = Date.now()): void {
  try {
    if (!META_HOSTS.has(new URL(String(url)).hostname)) return;
    const pct = res.headers ? parseUsage(res.headers) : null;
    if (pct === null) return;
    latest = { pct, at: new Date(now).toISOString() };
    const crossed = (pct >= PAUSE_AT) !== (lastPersistedPct >= PAUSE_AT);
    if (crossed || now - lastPersistAt >= PERSIST_EVERY_MS) {
      lastPersistAt = now;
      lastPersistedPct = pct;
      void setPlatformSetting(KEY, latest).catch(() => undefined);
    }
  } catch { /* observing must never affect the call it observes */ }
}

/** The freshest reading this instance or any other has seen, or null if none in the last hour. */
export async function metaAppUsage(now = Date.now()): Promise<MetaUsage | null> {
  const stored = await getPlatformSetting<MetaUsage | null>(KEY, null).catch(() => null);
  const fresher = [latest, stored]
    .filter((u): u is MetaUsage => !!u && Number.isFinite(Date.parse(u.at)) && now - Date.parse(u.at) < STALE_MS)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return fresher[0] ?? null;
}

/** False once the app is at PAUSE_AT: background Meta work should wait. */
export async function metaBackgroundAllowed(now = Date.now()): Promise<boolean> {
  const u = await metaAppUsage(now);
  return !u || u.pct < PAUSE_AT;
}

/** Tests only. */
export function _resetMetaUsage(): void {
  latest = null; lastPersistAt = 0; lastPersistedPct = -1;
}

/**
 * Wrap the server's fetch so every Meta response passes through
 * observeMetaResponse. Called once from instrumentation.ts. Reads headers
 * only, after the response is back, and swallows its own errors: it cannot
 * change, delay or fail a call.
 */
export function installMetaObserver(): void {
  const original = globalThis.fetch as typeof fetch & { __metaObserved?: boolean };
  if (original.__metaObserved) return;
  const observed = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("graph.facebook.com") || url.includes("graph.instagram.com")) observeMetaResponse(url, res);
    } catch { /* never let observing affect the call */ }
    return res;
  }) as typeof fetch & { __metaObserved?: boolean };
  observed.__metaObserved = true;
  globalThis.fetch = observed;
}

const ALERT_KEY = "meta_usage_alert_at";
const ALERT_EVERY_MS = 6 * 60 * 60_000;

/**
 * One email to the platform owner when the app is at PAUSE_AT. At 100% Meta
 * blocks the app's calls (#4) for every workspace on it, so this is the
 * warning that was missing on 23 Oct. Off with PLATFORM_ALERT_EMAILS=off, like
 * the other platform alerts.
 */
export async function drainMetaUsageAlert(now = Date.now()): Promise<{ alerted: boolean; pct: number | null }> {
  const usage = await metaAppUsage(now);
  if (!usage || usage.pct < PAUSE_AT) return { alerted: false, pct: usage?.pct ?? null };
  if ((process.env.PLATFORM_ALERT_EMAILS ?? "").toLowerCase() === "off") return { alerted: false, pct: usage.pct };
  const to = process.env.ADMIN_USER;
  if (!to) return { alerted: false, pct: usage.pct };
  const last = Date.parse(await getPlatformSetting<string>(ALERT_KEY, ""));
  if (Number.isFinite(last) && now - last < ALERT_EVERY_MS) return { alerted: false, pct: usage.pct };
  await setPlatformSetting(ALERT_KEY, new Date(now).toISOString());

  const { html, text } = renderEmail({
    preheader: `${usage.pct}% of the Meta app's hourly allowance is used.`,
    heading: "Meta is close to blocking the app",
    paragraphs: [
      `The Meta app this deployment runs on has used ${usage.pct}% of its application-level rate limit for the last hour. At 100% Meta refuses the app's calls (error #4) for every workspace connected through it until the hour rolls forward.`,
      "Find what is calling: Meta App Dashboard → Application Rate Limit → View Details → \"Most Active Endpoints Over Last 24 Hours\". Calls that fail count too, so a broken token or a missing permission repeated every minute is the usual cause.",
    ],
    highlight: "Throttled to once every 6 hours. Set PLATFORM_ALERT_EMAILS=off to stop these entirely.",
    cta: { label: "Open the Owner Console", href: "/admin/owner" },
    footerReason: "You're getting this because you're the platform owner (ADMIN_USER) and the Meta app is near its rate limit.",
  }, SITE_URL);
  await sendEmail({ to, subject: `Talko AI: Meta app at ${usage.pct}% of its rate limit`, html, text, type: "platform_alert" });
  return { alerted: true, pct: usage.pct };
}
