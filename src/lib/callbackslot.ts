// Turning "Call me this evening" into a time a counsellor is actually free.
//
// Every callback button in the RNR brief used to produce the same task, due
// in thirty minutes, whatever the lead picked. A lead who deliberately chose
// "tomorrow" got a counsellor ringing them half an hour later — which is the
// one thing a time-slot button promises not to do, and the fastest way to
// teach leads that the buttons are decoration.
//
// ── Everything is clamped into calling hours ───────────────────────────────
//
// A tap at 22:40 must not schedule a 22:55 call. Every slot below is pushed
// into the next stretch of calling hours rather than being honoured
// literally, so the worst a lead gets is a call the following morning
// instead of one at eleven at night.
//
// ── Why the hours are an argument ──────────────────────────────────────────
//
// The brief says messages go out 10 AM to 8 PM; Sabrish says callbacks happen
// 11 AM to 5 PM. Those are two different windows for two different things —
// when we may MESSAGE somebody and when a human can RING them — and the
// meeting did not settle the second. Passing them in means the answer is a
// setting when it arrives, not a deploy.

import { hourIn, weekdayIn, atHourIn, addDaysIn } from "./businessclock";

/** Half-open business-local-hour window [start, end) in which a counsellor can call. */
export interface CallHours { startHour: number; endHour: number }

/**
 * When a counsellor can actually ring somebody: 11 AM to 5 PM.
 *
 * Settled by the 30 September message library, which rewrote every slot to
 * fit it and dropped "this evening" and "this weekend" for having no
 * counsellor behind them. An earlier pass here used the brief's messaging
 * window of 10–8; that is when we may SEND, which is a different question
 * and stays on the sequence.
 */
export const DEFAULT_CALL_HOURS: CallHours = { startHour: 11, endHour: 17 };

/** "Call me now" — the library promises a call within thirty minutes. */
export const CALL_NOW_MINUTES = 30;

/** Where an unqualified callback lands when the lead has not said when. */
export const DEFAULT_CALLBACK_MINUTES = 30;

/** The hour a morning slot aims for — the first hour anybody is calling. */
const MID_MORNING = 11;

/** The hour an afternoon slot aims for: the library's "1 PM to 5 PM". */
const AFTERNOON = 13;

/**
 * The hour "this evening" would mean.
 *
 * No button offers it any more. The parser keeps it because a template
 * approved before the library was written can still be in Meta's list, and
 * a slot we cannot read becomes a generic callback — which is worse than
 * reading it and clamping it into calling hours.
 */
const EVENING = 18;

// Both read the clock where the BUSINESS is, not where the server is. On
// Vercel those differ by five and a half hours, which turned 11 AM calling
// hours into 16:30 ones — see businessclock.ts.
const atHour = (d: Date, hour: number): Date => atHourIn(d, hour);
const addDays = (d: Date, n: number): Date => addDaysIn(d, n);

/**
 * Move a moment into calling hours.
 *
 * Before the day opens → this morning's opening. At or after it closes →
 * tomorrow's opening. Inside → untouched, to the minute, because a lead who
 * asked for 18:00 should get 18:00 and not a rounded 18:00-ish.
 */
export function clampToCallHours(at: Date, hours: CallHours = DEFAULT_CALL_HOURS): Date {
  const h = hourIn(at);
  if (h < hours.startHour) return atHour(at, hours.startHour);
  if (h >= hours.endHour) return atHour(addDays(at, 1), hours.startHour);
  return new Date(at);
}

/** Saturday and Sunday. */
const isWeekend = (d: Date): boolean => weekdayIn(d) === 0 || weekdayIn(d) === 6;

/**
 * The next weekend moment at or after `from`.
 *
 * A lead tapping "this weekend" ON a Saturday morning means today, so today
 * counts when there is still calling time left in it. Otherwise it is the
 * coming Saturday — never the one just gone.
 */
function nextWeekend(from: Date, hours: CallHours): Date {
  if (isWeekend(from)) {
    const today = atHour(from, MID_MORNING);
    // Still worth ringing today? Only if 11:00 has not passed, or it has but
    // the day is not over — in which case the clamp below keeps it today.
    if (hourIn(from) < hours.endHour) {
      return today.getTime() >= from.getTime() ? today : new Date(from);
    }
  }
  // Days until the coming Saturday. Today-if-Saturday was handled above, so
  // a Saturday reaching here is one whose calling hours are finished.
  const day = weekdayIn(from);               // 0 Sun … 6 Sat
  const delta = ((6 - day) + 7) % 7 || 7;
  return atHour(addDays(from, delta), MID_MORNING);
}

/**
 * When a counsellor should ring, given the slot the lead chose.
 *
 * `slot` is the free text from RNR_TAPS — "this evening", "tomorrow", "this
 * weekend", or "unspecified" when the lead said "later" without saying when.
 * Anything unrecognised falls back to the default callback delay rather than
 * throwing: a slot we cannot parse is still a lead who asked for a call.
 */
export function callbackAt(
  slot: string | null | undefined,
  now: Date,
  hours: CallHours = DEFAULT_CALL_HOURS,
): Date {
  const s = (slot ?? "").trim().toLowerCase();

  // Order matters: "tomorrow afternoon" contains "tomorrow", so the specific
  // half-day has to be recognised before the bare day.
  if (s.includes("tomorrow morning") || s.includes("11 am to 1 pm")) {
    return clampToCallHours(atHour(addDays(now, 1), MID_MORNING), hours);
  }
  if (s.includes("tomorrow afternoon") || s.includes("1 pm to 5 pm")) {
    return clampToCallHours(atHour(addDays(now, 1), AFTERNOON), hours);
  }

  // "Later today" is a promise about TODAY — the library's reply says "before
  // 5 PM today". Soon, then, rather than at a named hour; the clamp is what
  // stops it landing after the team has gone home, by moving it to tomorrow
  // morning rather than by quietly promising a call at six.
  if (s.includes("later today")) {
    return clampToCallHours(new Date(now.getTime() + DEFAULT_CALLBACK_MINUTES * 60_000), hours);
  }

  if (s.includes("evening")) {
    const today = atHour(now, EVENING);
    // Past this evening already → the next one, not thirty minutes ago.
    const target = today.getTime() > now.getTime() ? today : atHour(addDays(now, 1), EVENING);
    return clampToCallHours(target, hours);
  }

  if (s.includes("weekend")) return clampToCallHours(nextWeekend(now, hours), hours);

  if (s.includes("tomorrow")) return clampToCallHours(atHour(addDays(now, 1), MID_MORNING), hours);

  // "Later", unspecified, or anything we do not recognise.
  return clampToCallHours(new Date(now.getTime() + DEFAULT_CALLBACK_MINUTES * 60_000), hours);
}

/** "Call me now" — soon, but never outside calling hours. */
export function callNowAt(now: Date, hours: CallHours = DEFAULT_CALL_HOURS): Date {
  return clampToCallHours(new Date(now.getTime() + CALL_NOW_MINUTES * 60_000), hours);
}

/**
 * A snooze, in whole days, landing mid-morning.
 *
 * "Check back in 2 weeks" is a promise about a DAY, not a minute, so it aims
 * at 11:00 on that day rather than at whatever time the lead happened to tap.
 */
export function snoozeUntil(days: number, now: Date, hours: CallHours = DEFAULT_CALL_HOURS): Date {
  const d = Math.max(1, Math.round(days));
  return clampToCallHours(atHour(addDays(now, d), MID_MORNING), hours);
}

/** Minutes from `now` until `at`, never negative — what the CRM task wants. */
export function minutesUntil(at: Date, now: Date): number {
  return Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
}
