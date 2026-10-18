// The date windows the dashboard can be read over.
//
// Everything used to be hard-wired to 14 days: getAnalytics built exactly 14
// daily buckets, the rail card was titled "last 14 days", and the payload
// carried fields literally named replied14d / aiReplies14d / new14d. So there
// was no way to ask "how has this performed since we launched?", and nowhere to
// put the answer if there had been.
//
// Pure and dependency-free so the server can compute buckets with it and the
// client can label them with the same names — a range whose label and data
// disagree is worse than one option.

export type RangeKey = "7d" | "14d" | "30d" | "90d" | "all";

export const DEFAULT_RANGE: RangeKey = "30d";

/** `days: null` means lifetime — no lower bound at all. */
export const RANGES: { key: RangeKey; label: string; short: string; days: number | null }[] = [
  { key: "7d",  label: "Last 7 days",   short: "7d",       days: 7 },
  { key: "14d", label: "Last 14 days",  short: "14d",      days: 14 },
  { key: "30d", label: "Last 30 days",  short: "30d",      days: 30 },
  { key: "90d", label: "Last 90 days",  short: "90d",      days: 90 },
  { key: "all", label: "All time",      short: "all time", days: null },
];

export function isRangeKey(v: unknown): v is RangeKey {
  return typeof v === "string" && RANGES.some(r => r.key === v);
}

/** Parses whatever arrived on the query string, falling back rather than throwing. */
export function parseRange(v: unknown): RangeKey {
  return isRangeKey(v) ? v : DEFAULT_RANGE;
}

export function rangeDays(key: RangeKey): number | null {
  return RANGES.find(r => r.key === key)?.days ?? null;
}

export function rangeLabel(key: RangeKey): string {
  return RANGES.find(r => r.key === key)?.label ?? "Last 30 days";
}

/** "last 30 days" / "all time" — reads naturally mid-sentence. */
export function rangeShort(key: RangeKey): string {
  const r = RANGES.find(x => x.key === key);
  return r ? (r.days === null ? "all time" : `last ${r.days} days`) : "last 30 days";
}

/**
 * Start of the window, or null for lifetime. Always a UTC day boundary.
 *
 * UTC, not local, because bucketKey() derives its key by slicing the ISO
 * timestamp on wa_send_log.sent_at — which is UTC. Building the boundaries in
 * local time and the keys in UTC put them 5.5 hours apart on this account, so
 * messages sent either side of local midnight landed in a bucket the window had
 * not generated and vanished from the chart. One clock for both.
 */
export function rangeStart(key: RangeKey, now = new Date()): Date | null {
  const days = rangeDays(key);
  if (days === null) return null;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (days - 1));   // inclusive of today
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export type Granularity = "day" | "week" | "month";

/**
 * How to slice a window into chart buckets.
 *
 * A daily bucket per day is right for a month and absurd for three years — the
 * whole reason "all time" needed thinking about rather than just dropping the
 * lower bound. Anything up to ~5 weeks stays daily; up to ~9 months goes weekly;
 * beyond that, monthly. So a lifetime chart stays a readable number of bars
 * however long the workspace has existed.
 */
export function granularityFor(spanDays: number): Granularity {
  if (spanDays <= 35) return "day";
  if (spanDays <= 280) return "week";
  return "month";
}

/** The bucket a timestamp belongs to, as the key the series is built on. */
export function bucketKey(iso: string, g: Granularity): string {
  const day = iso.slice(0, 10);
  if (g === "day") return day;
  if (g === "month") return day.slice(0, 7);
  // Week buckets are keyed by their MONDAY, so the label is a real date rather
  // than an ISO week number nobody reads at a glance.
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;         // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Every bucket key from `from` to `to` inclusive, so a quiet day still appears
 * as a zero rather than collapsing the series and shifting every bar left.
 */
export function bucketKeys(from: Date, to: Date, g: Granularity): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  // UTC midday and UTC steps, to match bucketKey() and rangeStart(). Midday
  // keeps the walk clear of any boundary rounding at either end.
  const cur = new Date(from);
  cur.setUTCHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(12, 0, 0, 0);
  // Hard stop: a corrupt earliest-timestamp must not spin forever.
  for (let i = 0; cur <= end && i < 4000; i++) {
    const k = bucketKey(cur.toISOString(), g);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return keys;
}
