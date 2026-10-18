// What a tapped button means, and what should happen because of it.
//
// ── Why the button LABEL is the identifier ──────────────────────────────────
//
// A quick-reply button on an approved template arrives back as an ordinary
// inbound message whose body is the button's own text (wa-message.ts, the
// `type === "button"` branch). Meta does not hand us a stable payload id for
// template quick-replies the way it does for interactive list rows, so the
// label IS the routing key whether we like it or not.
//
// That is fragile in one specific way: change "Yes, call me now" to "Call me
// now" in the template and the routing silently stops matching, the drip
// keeps running, and nobody is told. So the labels live HERE, once, and the
// template definitions are built from this list rather than typed again next
// to it. A test pins every label, so an edit that breaks routing fails in CI
// instead of in production four weeks into a campaign.
//
// ── Why matching is normalised rather than exact ────────────────────────────
//
// Two things arrive that are not the label: a lead who TYPES "call me now"
// instead of tapping, and a label that came back with different spacing or
// case. Both mean the same thing to the person who sent them, and refusing
// them because of a capital letter would drop exactly the high-intent replies
// this whole system exists to catch.
//
// What it will NOT do is fuzzy-match. "Do not call me now" contains "call me
// now" and means the opposite, so matching is on the whole normalised string,
// never a substring.

import type { Lane } from "./lanes";
import {
  callbackAt, callNowAt, snoozeUntil, clampToCallHours,
  DEFAULT_CALLBACK_MINUTES, CALL_NOW_MINUTES,
  type CallHours,
} from "./callbackslot";

/** What the lead actually asked for. */
export type TapIntent =
  | "call_now"      // wants a call immediately
  | "call_slot"     // wants a call at a named time
  | "chat"          // wants to continue in WhatsApp, not by phone
  | "explore"       // not ready; wants material
  | "register"      // wants the masterclass seat
  | "snooze"        // not now, come back later
  | "close";        // stop entirely

export interface TapSpec {
  label: string;
  intent: TapIntent;
  /** Free text describing the slot, for the counsellor's task. */
  slot?: string;
  /** Days to wait before a human picks this lead up again. */
  snoozeDays?: number;
}

/**
 * Every button the RNR journey can send, in one place.
 *
 * Message A and B, then the seven drip steps. The template builder reads this
 * to render the buttons; the router below reads it to interpret the taps. One
 * list, so the two can never disagree.
 */
export const RNR_TAPS: readonly TapSpec[] = [
  // ── T1 · Message A ───────────────────────────────────────────────────────
  { label: "Yes, call me now", intent: "call_now" },
  { label: "Yes, call me later", intent: "call_slot", slot: "unspecified" },
  { label: "Just exploring", intent: "explore" },

  // ── T2 · Message B ───────────────────────────────────────────────────────
  { label: "Call me later today", intent: "call_slot", slot: "later today" },
  { label: "Call me tomorrow", intent: "call_slot", slot: "tomorrow" },
  { label: "Chat on WhatsApp", intent: "chat" },

  // ── The drip, T3–T9 ──────────────────────────────────────────────────────
  //
  // "Request a callback" appears on five of the seven. The library made them
  // all the same on purpose: until Sabrish says who owns a drip tap, every
  // one of them has to mean the same thing to whoever picks it up.
  { label: "Request a callback", intent: "call_now" },
  { label: "Send course details", intent: "explore" },
  { label: "Register me", intent: "register" },
  { label: "Not this time", intent: "snooze", snoozeDays: 14 },
  { label: "How the refund works", intent: "explore" },
  { label: "Book a centre visit", intent: "call_now" },
  { label: "Share fees and EMI", intent: "explore" },
  { label: "Yes, keep it open", intent: "call_now" },      // library: same as Request a callback
  { label: "Check back in 2 weeks", intent: "snooze", snoozeDays: 14 },
  { label: "Close my enquiry", intent: "close" },

  // ── Second-level buttons we send ourselves ───────────────────────────────
  //
  // These are interactive reply buttons on a normal chat message, not
  // template buttons — the lead's first tap opened the 24-hour window, so no
  // approval is needed. They still come back as ordinary inbound text, so
  // they route through exactly the same catalogue.
  { label: "Later today", intent: "call_slot", slot: "later today" },
  { label: "Tomorrow morning", intent: "call_slot", slot: "tomorrow morning" },
  { label: "Tomorrow afternoon", intent: "call_slot", slot: "tomorrow afternoon" },
  { label: "11 AM to 1 PM", intent: "call_slot", slot: "tomorrow morning" },
  { label: "1 PM to 5 PM", intent: "call_slot", slot: "tomorrow afternoon" },
  { label: "Course details", intent: "explore" },
  { label: "Free masterclass", intent: "register" },
  // The 20-character form of "Check back in 2 weeks" (21). That length is
  // fine on a template quick-reply, which may be 25, and one over the limit
  // for an interactive reply button. Meta truncates rather than refusing, so
  // the long spelling sent as a button would come back as "Check back in 2
  // week" and match nothing. Both spellings mean the same thing.
  { label: "Remind me in 2 weeks", intent: "snooze", snoozeDays: 14 },
];

/** Lowercased, collapsed whitespace, no trailing punctuation. */
export function normaliseTap(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_LABEL = new Map<string, TapSpec>(
  RNR_TAPS.map(t => [normaliseTap(t.label), t]),
);

/** The button this text corresponds to, or null if it is an ordinary reply. */
export function matchTap(text: string): TapSpec | null {
  return BY_LABEL.get(normaliseTap(text)) ?? null;
}

/**
 * What the portal should do about an inbound message.
 *
 * Returned as a plan rather than executed here so the decision is testable
 * without a database, a CRM or a WhatsApp account — and so the caller can see
 * every consequence of a tap in one object instead of tracing five awaits.
 */
export interface TapPlan {
  intent: TapIntent | "reply";
  /** Always true: any tap or reply ends the journey. */
  stopSequence: true;
  /** Never message this person again. */
  optOut: boolean;
  /**
   * Hand to a human, and WHEN.
   *
   * An absolute moment rather than a delay, because the whole point of a slot
   * button is that "tomorrow" is a time of day and not a number of minutes.
   * Minutes could not express it without the caller knowing the calling
   * hours, which is exactly the knowledge this plan exists to carry.
   */
  task: { name: string; notes: string; dueAt: string } | null;
  /** One line for the CRM timeline, always written. */
  activity: string;
  /** Which lane should own the follow-up. */
  lane: Lane;
}

/**
 * Minutes a counsellor has to call back when the lead did not name a time.
 *
 * Kept as a named export because the RNR brief quotes it in copy; the actual
 * scheduling goes through callbackslot.ts, which also refuses to put a task
 * outside calling hours.
 */
export const CALLBACK_MINUTES = DEFAULT_CALLBACK_MINUTES;

/** Same, for the "call me now" promise the brief makes to the lead. */
export { CALL_NOW_MINUTES };

/**
 * Turn an inbound message into the plan.
 *
 * An unmatched message is NOT ignored — it is a reply, and a reply stops the
 * journey and raises a task just as a tap does. Somebody who types "what are
 * the fees?" is the most engaged lead in the list, and routing them only
 * because they happened to use a button would be the wrong way round.
 *
 * `now` is injectable so every slot below can be tested at a fixed moment;
 * `hours` so the callback window stays a setting rather than a deploy once
 * sales settle whether it is 10–8 or 11–5.
 */
export function planForTap(text: string, now: Date = new Date(), hours?: CallHours): TapPlan {
  const spec = matchTap(text);
  const base = { stopSequence: true as const, lane: "sales" as Lane };
  const iso = (d: Date) => d.toISOString();
  /** A task with no named time still must not land at two in the morning. */
  const soon = () => iso(clampToCallHours(new Date(now.getTime() + DEFAULT_CALLBACK_MINUTES * 60_000), hours));

  if (!spec) {
    return {
      ...base, intent: "reply", optOut: false,
      task: {
        name: "WhatsApp reply — call back",
        notes: `Lead replied on WhatsApp: "${(text ?? "").slice(0, 200)}"`,
        dueAt: soon(),
      },
      activity: `Replied on WhatsApp: ${(text ?? "").slice(0, 200)}`,
    };
  }

  switch (spec.intent) {
    case "close":
      // The only intent that suppresses future sends. Treated exactly like an
      // inbound STOP, because that is what the lead meant.
      return {
        ...base, intent: "close", optOut: true, task: null,
        activity: "Asked to close the enquiry (WhatsApp). Opted out of further messages.",
      };

    case "snooze": {
      const days = spec.snoozeDays ?? 14;
      return {
        ...base, intent: "snooze", optOut: false,
        task: {
          name: "Check back — lead asked for later",
          notes: `Lead tapped "${spec.label}". No WhatsApp messages until a human restarts it.`,
          dueAt: iso(snoozeUntil(days, now, hours)),
        },
        activity: `Asked to be contacted later (${spec.label}).`,
      };
    }

    case "call_now":
      return {
        ...base, intent: "call_now", optOut: false,
        task: {
          name: "Call now — lead asked on WhatsApp",
          notes: `Lead tapped "${spec.label}". Promised a call within ${CALL_NOW_MINUTES} minutes.`,
          dueAt: iso(callNowAt(now, hours)),
        },
        activity: `Asked for a call now (${spec.label}).`,
      };

    case "call_slot":
      // The one intent where the lead named a time. Honouring it is the whole
      // reason the button exists — see callbackslot.ts.
      return {
        ...base, intent: "call_slot", optOut: false,
        task: {
          name: `Call back — ${spec.slot ?? "time requested"}`,
          notes: `Lead tapped "${spec.label}". Call at the time they chose.`,
          dueAt: iso(callbackAt(spec.slot, now, hours)),
        },
        activity: `Chose a callback time: ${spec.slot ?? spec.label}.`,
      };

    case "chat":
      return {
        ...base, intent: "chat", optOut: false,
        task: {
          name: "Reply on WhatsApp — lead prefers chat",
          notes: `Lead tapped "${spec.label}". They want to continue in chat, not by phone.`,
          dueAt: soon(),
        },
        activity: "Chose to continue on WhatsApp rather than by phone.",
      };

    case "register":
      return {
        ...base, intent: "register", optOut: false,
        task: {
          name: "Masterclass registration from WhatsApp",
          notes: `Lead tapped "${spec.label}".`,
          dueAt: soon(),
        },
        activity: "Registered for the masterclass from WhatsApp.",
      };

    case "explore":
      // Interested but not ready for a call. Still a human's job, just not an
      // urgent one — a same-day task rather than a 15-minute promise the
      // brief never made for this button.
      return {
        ...base, intent: "explore", optOut: false,
        task: {
          name: "Send what the lead asked for",
          notes: `Lead tapped "${spec.label}".`,
          dueAt: iso(clampToCallHours(new Date(now.getTime() + 4 * 60 * 60_000), hours)),
        },
        activity: `Asked for information (${spec.label}).`,
      };
  }
}
