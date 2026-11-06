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

// ── Date-range presets shared by every data screen ───────────────────────────
//
// Analytics, Results, Team Progress and Review reports each had their own set
// of windows (7/14/30/90/all, 7/30/90, 1/7/14/30/90, 7/30/90/365 + custom) in
// three different controls. One list, in one order, with one set of names; a
// screen picks the presets its API can actually answer and nothing else.

export type PresetKey = "24h" | "7d" | "30d" | "90d" | "12m" | "all" | "custom";

export interface RangePreset {
  key: PresetKey;
  /** Full name, used on wider screens and as the accessible name. */
  label: string;
  /** Shorter name for phones. Always a word-for-word part of `label`. */
  short: string;
  /** Length in days; null for all time and for custom dates. */
  days: number | null;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  // Team Progress counts a rolling day (now minus 24 hours), not "since
  // midnight" — so it is named for what it counts.
  { key: "24h",    label: "Last 24 hours",  short: "24 hours",  days: 1 },
  { key: "7d",     label: "Last 7 days",    short: "7 days",    days: 7 },
  { key: "30d",    label: "Last 30 days",   short: "30 days",   days: 30 },
  { key: "90d",    label: "Last 90 days",   short: "90 days",   days: 90 },
  { key: "12m",    label: "Last 12 months", short: "12 months", days: 365 },
  { key: "all",    label: "All time",       short: "All time",  days: null },
  { key: "custom", label: "Custom dates",   short: "Custom",    days: null },
];

/** The presets a screen offers, always in the canonical order above. Unknown keys are dropped. */
export function presetOptions(keys: readonly PresetKey[]): RangePreset[] {
  return RANGE_PRESETS.filter(p => keys.includes(p.key));
}

export function presetByKey(key: string): RangePreset | undefined {
  return RANGE_PRESETS.find(p => p.key === key);
}

/** The preset for a day count (7 → "7d"), or undefined when none matches. */
export function presetForDays(days: number, keys: readonly PresetKey[] = RANGE_PRESETS.map(p => p.key)): RangePreset | undefined {
  return presetOptions(keys).find(p => p.days === days);
}

/** A local calendar day as YYYY-MM-DD (what <input type="date"> reads and writes). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** First and last day (inclusive) of an N-day window ending today. */
export function presetDates(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - (Math.max(1, days) - 1));
  return { from: isoDay(from), to: isoDay(now) };
}

/** Why a custom from/to pair can't be used, in words — or null when it can. */
export function customRangeProblem(from: string, to: string, opts: { maxDays?: number; today?: string } = {}): string | null {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ok(from) || !ok(to)) return "Choose both a start and an end date.";
  if (from > to) return "The start date is after the end date.";
  if (opts.today && to > opts.today) return "The end date is in the future.";
  if (opts.maxDays) {
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (span > opts.maxDays) return `Choose a period of ${opts.maxDays >= 365 ? "a year" : `${opts.maxDays} days`} or less.`;
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * How a chart bucket key reads: a day "6 Nov", a week "Week of 3 Nov", a month
 * "Nov 2026". `withYear` always adds the year (for exports and tables).
 */
export function bucketLabel(key: string, g: Granularity, opts: { withYear?: boolean; now?: Date } = {}): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (!m) return key;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  if (g === "month" || !d) return `${month} ${y}`;
  const thisYear = (opts.now ?? new Date()).getFullYear();
  const day = `${Number(d)} ${month}${opts.withYear || Number(y) !== thisYear ? ` ${y}` : ""}`;
  return g === "week" ? `Week of ${day}` : day;
}

/** "previous 15 days" / "previous 3 months" — the comparison window, in words. */
export function previousWindow(n: number, g: Granularity): string {
  const unit = g === "month" ? "month" : g === "week" ? "week" : "day";
  return `previous ${n} ${unit}${n === 1 ? "" : "s"}`;
}
