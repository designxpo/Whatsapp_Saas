// What time it is where the business is.
//
// ── The bug this exists to kill ────────────────────────────────────────────
//
// Every time rule in this codebase — the drip's send window, calling hours,
// "one message a day" — was written with Date's LOCAL accessors: getHours,
// setHours, getDate. On the author's machine local time is IST, so all of it
// read correctly and every test passed.
//
// Production is Vercel, and Vercel is UTC. Measured 1 October by standing up
// a sequence whose window was 03:00–04:00 and watching what the cron did with
// it: the step EXECUTED at 03:00 UTC. Had the server been IST that moment was
// 08:30 and it would have deferred. So the server's "local" is UTC, and a
// sequence configured to send between 10 and 20 was sending between 10:00 and
// 20:00 UTC — which is 15:30 to 01:30 IST.
//
// Nothing was obviously broken, which is what made it dangerous. Messages
// still went out; they went out at half past one in the morning. Calling
// hours of 11–17 meant callbacks booked for 16:30–22:30 IST. The daily cap
// reset at 05:30 IST, so two "one a day" messages could land in one working
// morning.
//
// ── Why not just set TZ=Asia/Kolkata and be done ───────────────────────────
//
// Because it is a single environment variable standing between the business
// and messaging leads at 1 AM, with nothing in the UI that would ever show it
// had been lost. An env var is also invisible to the test suite: the whole
// class of bug would come straight back the first time somebody ran the cron
// anywhere else.
//
// So the timezone is named in code and the wall-clock reads go through here.
// Correct by construction on any server, in any test, whatever TZ says.
// BUSINESS_TZ can still override it — a second office is a config change, not
// a deploy — but the default is the answer, not a fallback.

/** The timezone the business runs on. Overridable, but rarely should be. */
export const BUSINESS_TZ = (): string => (process.env.BUSINESS_TZ ?? "").trim() || "Asia/Kolkata";

/** Wall-clock fields, as a human in that timezone would read them. */
export interface Wall {
  year: number;
  /** 1–12, not Date's 0–11. The off-by-one is the whole reason to restate it. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// Intl.DateTimeFormat construction is not free and this runs per enrolment
// per cron tick, so the formatters are kept.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

/** Read an instant as wall-clock time in the business timezone. */
export function partsIn(at: Date, tz: string = BUSINESS_TZ()): Wall {
  const got: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(at)) if (p.type !== "literal") got[p.type] = p.value;
  return {
    year: Number(got.year), month: Number(got.month), day: Number(got.day),
    hour: Number(got.hour), minute: Number(got.minute), second: Number(got.second),
  };
}

/** The hour of the day, 0–23, in the business timezone. */
export const hourIn = (at: Date, tz: string = BUSINESS_TZ()): number => partsIn(at, tz).hour;

/** Day of the week in the business timezone, 0 Sunday … 6 Saturday. */
export function weekdayIn(at: Date, tz: string = BUSINESS_TZ()): number {
  const p = partsIn(at, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Do two instants fall on the same calendar day where the business is? */
export function sameDayIn(a: Date, b: Date, tz: string = BUSINESS_TZ()): boolean {
  const x = partsIn(a, tz), y = partsIn(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(at: Date, tz: string): number {
  const p = partsIn(at, tz);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUTC - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at which the business's wall clock reads these fields.
 *
 * Resolved twice because the offset to subtract is itself a function of the
 * instant. India has no daylight saving so one pass would do today, but a
 * zone that does would land an hour out on two days a year — the kind of bug
 * that surfaces as "the Sunday the drip went out at nine".
 */
export function instantAt(w: Partial<Wall> & { year: number; month: number; day: number }, tz: string = BUSINESS_TZ()): Date {
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0, w.second ?? 0);
  let t = asUTC - offsetAt(new Date(asUTC), tz);
  t = asUTC - offsetAt(new Date(t), tz);
  return new Date(t);
}

/** The same business day as `at`, at `hour` exactly — minutes and below zeroed. */
export function atHourIn(at: Date, hour: number, tz: string = BUSINESS_TZ()): Date {
  const p = partsIn(at, tz);
  return instantAt({ year: p.year, month: p.month, day: p.day, hour, minute: 0, second: 0 }, tz);
}

/**
 * `n` business days later, same wall-clock time.
 *
 * Date.UTC normalises the rollover, so 31 October + 1 is 1 November without
 * anyone having to know how long October is.
 */
export function addDaysIn(at: Date, n: number, tz: string = BUSINESS_TZ()): Date {
  const p = partsIn(at, tz);
  const rolled = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return instantAt({
    year: rolled.getUTCFullYear(), month: rolled.getUTCMonth() + 1, day: rolled.getUTCDate(),
    hour: p.hour, minute: p.minute, second: p.second,
  }, tz);
}

/** Midnight at the start of the business day containing `at`. */
export const startOfDayIn = (at: Date, tz: string = BUSINESS_TZ()): Date => atHourIn(at, 0, tz);
