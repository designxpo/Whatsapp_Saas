// When a drip step is allowed to send, and when a drip must stop talking.
//
// Both rules are pure functions here rather than inline in drainSequences,
// because both are the kind of logic that is easy to get subtly wrong at a
// boundary (midnight, an exactly-equal timestamp, a reply that arrived one
// second before the step was claimed) and impossible to test once it is
// wrapped in a database loop.
//
// "Local" below means local TO THE BUSINESS, not to the server. Those were
// the same thing on the machine this was written on and are not the same
// thing on Vercel, which runs UTC — see businessclock.ts for the measurement
// and what it was doing to the send times.

import { hourIn, atHourIn, addDaysIn, startOfDayIn } from "./businessclock";

/** A half-open send window in business-local hours: [start, end). Null = no restriction. */
export interface SendWindow {
  startHour: number | null;
  endHour: number | null;
}

export const hasWindow = (w: SendWindow): boolean =>
  typeof w.startHour === "number" && typeof w.endHour === "number";

/**
 * May a step send at this moment?
 *
 * No window configured → always yes, which is how every sequence behaved
 * before 0101.
 */
export function withinSendWindow(w: SendWindow, at: Date): boolean {
  if (!hasWindow(w)) return true;
  const h = hourIn(at);
  return h >= (w.startHour as number) && h < (w.endHour as number);
}

/**
 * The moment this step should be retried, given it arrived outside the window.
 *
 * Deferred, never dropped. Returning the next opening rather than skipping is
 * the whole point: a skipped nurture message is a lead who was never
 * contacted, and nothing in the UI would ever show it.
 *
 * Before the window opens today → today's opening. At or after it closes →
 * tomorrow's. The minutes and seconds are zeroed so a deferral lands on the
 * hour rather than preserving whatever ragged time the delay arithmetic
 * produced, which keeps a whole cohort's messages from arriving at 19:47:33.
 */
export function nextWindowOpening(w: SendWindow, at: Date): Date {
  if (!hasWindow(w)) return at;
  const start = w.startHour as number;
  // At or past the close (or inside it — callers only ask when outside): the
  // next opening is tomorrow. addDaysIn handles month and year rollover.
  return hourIn(at) < start ? atHourIn(at, start) : atHourIn(addDaysIn(at, 1), start);
}

/**
 * Tomorrow's opening, whether or not we are inside the window right now.
 *
 * nextWindowOpening answers "when may this step go out", which is today's
 * opening if it has not happened yet. The daily cap needs a different
 * question — "when is this lead allowed to hear from us again" — and the
 * answer to that is never today, however early it is. With no window
 * configured the day still turns over, so it falls back to midnight.
 */
export function nextDayOpening(w: SendWindow, at: Date): Date {
  return atHourIn(addDaysIn(at, 1), hasWindow(w) ? (w.startHour as number) : 0);
}

/**
 * The business's calendar day containing `at`, as a half-open [from, to) range.
 *
 * The business's day and not the server's, because every other time rule here
 * is: a send window of 10–20 is 10 AM where the business is, and a cap of
 * "one a day" that reset at 05:30 IST — which is exactly what UTC midnight is
 * — would let two messages land in one working morning.
 */
export function localDayBounds(at: Date): { from: Date; to: Date } {
  return { from: startOfDayIn(at), to: atHourIn(addDaysIn(at, 1), 0) };
}

/** What drainSequences knows about the conversation when it checks the rule. */
export interface ReplyState {
  lastInboundAt: string | null;
  botEnabled: boolean | null;
  status: string | null;
}

/**
 * Should this enrolment stop because the lead came back, or a human did?
 *
 * `since` is the enrolment's own updated_at — the last time this journey did
 * anything. An inbound STRICTLY after that is a reply to what we sent, rather
 * than the message that enrolled them in the first place. Using `>` and not
 * `>=` matters: the inbound that triggers an enrolment can share a timestamp
 * with it, and `>=` would stop every such journey at step one.
 *
 * A missing conversation is NOT a reason to stop. It means nothing has been
 * exchanged on this channel yet, which is the normal state for a lead who has
 * never answered — precisely the audience this exists for.
 *
 * `botEnabled === false` or a non-active status means a person has taken the
 * conversation. Continuing to drip underneath a counsellor's live chat is the
 * same failure as talking over a reply, so it stops for the same reason.
 */
export function shouldStopForReply(
  conv: ReplyState | null | undefined,
  since: string | null | undefined,
): boolean {
  if (!conv) return false;
  if (conv.botEnabled === false) return true;
  if (conv.status != null && conv.status !== "active") return true;
  if (!conv.lastInboundAt || !since) return false;
  const inbound = Date.parse(conv.lastInboundAt);
  const mark = Date.parse(since);
  if (!Number.isFinite(inbound) || !Number.isFinite(mark)) return false;
  return inbound > mark;
}
