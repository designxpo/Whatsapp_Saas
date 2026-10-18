// One button, pressed after a call nobody answered.
//
// The brief is explicit that the counsellor does not choose the message:
//
//     Day 0, 1st call   Send Message A
//     Day 0, later      Nothing
//     Day 1, 1st call   Send Message B, only if no reply to A
//     Day 1, later      Nothing
//     "The counsellor only presses the button. The system decides whether
//      A, B or nothing goes out."
//
// That is the whole reason this exists rather than letting LeadSquared name
// a template. Every condition in the table depends on something LeadSquared
// cannot see: whether we already sent today, whether the lead wrote back,
// whether the number is even on WhatsApp. A button that made the counsellor
// pick would get it wrong on the second press of the day, every day.
//
// ── Why the state lives on the contact ─────────────────────────────────────
//
// Two timestamps, as contact attributes rather than a new table: migrations
// here are applied by hand, and a feature that cannot ship until somebody
// runs SQL is a feature that sits. They are also visible in the contact
// drawer, which is where somebody will look when they ask "did we message
// this lead already".
//
// ── Ordering is the design ─────────────────────────────────────────────────
//
// The rules are checked most-protective first, and each returns its own
// reason. A counsellor who presses the button and sees nothing happen is
// owed a sentence explaining why — "they replied an hour ago" and "you have
// already sent today" are different facts and lead to different actions.

/** Contact attribute holding when Message A went out. ISO, or absent. */
import { sameDayIn } from "./businessclock";

export const NUDGE_A_ATTR = "rnr_nudge_a_at";
/** Contact attribute holding when Message B went out. ISO, or absent. */
export const NUDGE_B_ATTR = "rnr_nudge_b_at";

/** The two call-attempt templates, in the order they are sent. */
export const NUDGE_A_TEMPLATE = "rnr_01_missed_call";
export const NUDGE_B_TEMPLATE = "rnr_02_call_retry";

/** A lead who wrote to us this recently is in a conversation, not a queue. */
export const RECENT_INBOUND_HOURS = 24;

export interface NudgeState {
  now: Date;
  /** Asked us to stop, by STOP or by tapping "Close my enquiry". */
  optedOut: boolean;
  /** Meta has told us this number has no WhatsApp account. */
  notOnWhatsApp: boolean;
  /** When Message A was sent, ISO. Null = never. */
  sentA: string | null;
  /** When Message B was sent, ISO. Null = never. */
  sentB: string | null;
  /** The lead's most recent inbound message, ISO. Null = never. */
  lastInboundAt: string | null;
}

export type NudgeDecision =
  | { send: "A" | "B"; template: string; why: string }
  | { send: null; why: string };

const ms = (iso: string | null): number => {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

/** The later of two possibly-absent timestamps, or NaN when neither is set. */
const latest = (a: number, b: number): number => {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.max(a, b);
};

// The business's day, not the server's. UTC midnight is 05:30 IST, so a
// server-local comparison would let the "one a day" cap reset in the middle
// of a working morning.
const sameLocalDay = (a: number, b: Date): boolean => sameDayIn(new Date(a), b);

/**
 * What should happen when the counsellor presses the button.
 *
 * Pure, so the whole table above can be tested without a database, a CRM or
 * a WhatsApp account — which is the only way to be sure the second press of
 * the day does nothing.
 */
export function decideNudge(s: NudgeState): NudgeDecision {
  if (s.optedOut) {
    return { send: null, why: "This lead has opted out of WhatsApp messages. Call them instead." };
  }
  if (s.notOnWhatsApp) {
    return { send: null, why: "WhatsApp says this number has no account — it may be a wrong number. Worth checking by phone." };
  }

  const a = ms(s.sentA);
  const b = ms(s.sentB);
  const lastNudge = latest(a, b);
  const inbound = ms(s.lastInboundAt);

  // They answered. Whatever the table says, the right move is a human, not
  // another template — and this is the condition the brief singles out for
  // Message B ("only if no reply to A").
  if (!Number.isNaN(inbound) && !Number.isNaN(lastNudge) && inbound > lastNudge) {
    return { send: null, why: "The lead replied after your last message. Open the chat and answer them." };
  }
  // Nothing sent yet, but they are already talking to us.
  if (!Number.isNaN(inbound) && Number.isNaN(lastNudge)
      && s.now.getTime() - inbound < RECENT_INBOUND_HOURS * 3600_000) {
    return { send: null, why: "The lead wrote to you in the last 24 hours. Reply in the chat rather than sending a template." };
  }

  // "Max one message a day." Pressed again after a second failed call, the
  // button is meant to do nothing.
  if (!Number.isNaN(lastNudge) && sameLocalDay(lastNudge, s.now)) {
    return { send: null, why: "A WhatsApp message already went to this lead today. One a day is the limit." };
  }

  // "Never the same one twice."
  if (Number.isNaN(a)) return { send: "A", template: NUDGE_A_TEMPLATE, why: "First unanswered call — sending Message A." };
  if (Number.isNaN(b)) return { send: "B", template: NUDGE_B_TEMPLATE, why: "No reply to the first message — sending Message B." };

  return {
    send: null,
    why: "Both call-attempt messages have been sent. Move the lead to Not Reachable and the four-week drip takes over.",
  };
}

/** Which attribute records the send, once it has happened. */
export const attrFor = (which: "A" | "B"): string => (which === "A" ? NUDGE_A_ATTR : NUDGE_B_ATTR);

/**
 * How far apart a stamp and a failure may be and still be the same message.
 *
 * Meta's failure webhook lands seconds after the send. A generous window
 * still cannot reach yesterday's message, and refusing to guess is the safe
 * outcome: retracting the WRONG stamp would re-send a message the lead
 * already has.
 */
export const REVERT_WINDOW_MS = 30 * 60_000;

/**
 * Which nudge a failed delivery should retract — the heart of a bug that
 * burnt a counsellor's whole day.
 *
 * Meta answers the send API with a message id, so the route records "A went
 * out" and tells the counsellor it sent. Seconds later a webhook says the
 * message was never delivered (131049 — the marketing frequency cap drops
 * it to "maintain healthy ecosystem engagement"). The stamp stays.
 *
 * Nothing recovers from that on its own. The one-a-day rule now refuses a
 * retry, and TOMORROW the lead is sent Message B — "we tried calling you
 * again" — referring to a Message A they never received. Measured on
 * 2026-10-13 against two live leads; the same drop hit a third on 7 October.
 *
 * So a failure retracts the stamp and the day is given back. Pure, because
 * picking the wrong one is worse than picking none and this has to be
 * testable without a webhook.
 */
export function nudgeToRevert(
  s: { sentA: string | null; sentB: string | null },
  failedAt: Date,
  windowMs = REVERT_WINDOW_MS,
): "A" | "B" | null {
  const t = failedAt.getTime();
  if (!Number.isFinite(t)) return null;

  let best: { which: "A" | "B"; gap: number } | null = null;
  for (const which of ["A", "B"] as const) {
    const at = ms(which === "A" ? s.sentA : s.sentB);
    if (Number.isNaN(at)) continue;
    const gap = Math.abs(at - t);
    // Outside the window this is some earlier message that did arrive.
    if (gap > windowMs) continue;
    if (!best || gap < best.gap) best = { which, gap };
  }
  return best?.which ?? null;
}
