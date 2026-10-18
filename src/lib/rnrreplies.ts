// What the lead hears back the moment they tap.
//
// Until now a tap stopped the drip and raised a CRM task, and the lead got
// silence. They pressed "Yes, call me now" and nothing happened on their
// screen — which reads as a broken button, and is the fastest way to teach
// people that these messages are not worth answering.
//
// Section 2 of the message library specifies a reply for every tap. They are
// ordinary chat messages, not templates: the lead's own tap opened the
// 24-hour window, so nothing here needs Meta's approval.
//
// ── The two button limits ──────────────────────────────────────────────────
//
// A template quick-reply may be 25 characters. An INTERACTIVE reply button —
// which is what these second-level choices are — may be 20. They are
// different limits on different objects and it is easy to carry the wrong
// one across.
//
// It bites exactly once here: the library offers "Check back in 2 weeks"
// (21) after "Just exploring". That is fine on T9, which is a template, and
// one character too long as a button. Meta truncates rather than refusing,
// so it would arrive as "Check back in 2 week" and match nothing in the tap
// router — the button would silently do nothing, forever. The interactive
// form is therefore the 20-character "Remind me in 2 weeks", and both
// spellings route to the same place.
//
// ── Degrading ──────────────────────────────────────────────────────────────
//
// Every sentence that names the counsellor works without one: an unassigned
// lead hears "A counsellor will call you", not "undefined will call you".
// Sentences that need a value we do not have at all — a course link, a
// masterclass date — drop the missing clause rather than print a blank.

import { hourIn } from "./businessclock";
import { matchTap, normaliseTap } from "./rnrtaps";
import { DEFAULT_CALL_HOURS, callNowAt, CALL_NOW_MINUTES, type CallHours } from "./callbackslot";

/** Meta's limit for an interactive reply button. NOT the template limit. */
export const INTERACTIVE_BUTTON_CHARS = 20;

/** Most reply buttons WhatsApp will show on one message. */
export const MAX_INTERACTIVE_BUTTONS = 3;

/** After this hour, "Later today" is no longer offered. */
export const HIDE_LATER_TODAY_AFTER = 16;

export interface ReplyPlan {
  /** The message body. Empty means say nothing — there is no such tap today. */
  text: string;
  /** Interactive reply buttons, at most three, each at most 20 characters. */
  buttons: string[];
}

export interface ReplyTokens {
  first_name?: string;
  counsellor_name?: string;
  course?: string;
  course_link?: string;
  centre_address?: string;
  masterclass_topic?: string;
  masterclass_date?: string;
  masterclass_time?: string;
  join_link?: string;
}

const val = (v: string | undefined): string => String(v ?? "").trim();

/** The counsellor by name, or the honest generic. Never a blank or "undefined". */
const who = (t: ReplyTokens): string => val(t.counsellor_name) || "A counsellor";
/** Same, mid-sentence. */
const whoLower = (t: ReplyTokens): string => val(t.counsellor_name) || "a counsellor";

/** "Thanks, Rahul." or just "Thanks." — never "Thanks, ." */
const thanks = (t: ReplyTokens): string => (val(t.first_name) ? `Thanks, ${val(t.first_name)}.` : "Thanks.");

/**
 * Will the call actually happen within the thirty minutes we are about to
 * promise?
 *
 * This used to ask whether NOW was inside calling hours, which is a
 * different question and gets the edges wrong in both directions. At 16:56
 * the clock says "open", but now + 30 minutes is 17:26 — past close — so
 * callbackslot defers the task to 11:00 tomorrow while the lead is told
 * somebody is ringing within the half hour. At 09:00 the clock says
 * "closed", yet the honest answer is "when we open at eleven", not "as soon
 * as we open" tacked onto a promise of thirty minutes.
 *
 * So the reply is derived from the SAME moment the task is due. The two can
 * then never disagree, which is the only property that matters here: an
 * unkeepable promise is worse than a slower one.
 */
const callsWithinPromise = (now: Date, hours: CallHours): boolean => {
  const due = callNowAt(now, hours);
  // A minute of slack absorbs the clamp's second-rounding without letting a
  // genuine deferral through.
  return due.getTime() - now.getTime() <= (CALL_NOW_MINUTES + 1) * 60_000;
};

const hoursPhrase = (h: CallHours): string => `${hour12(h.startHour)} and ${hour12(h.endHour)}`;

function hour12(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/**
 * The reply for one tap.
 *
 * `masterclassLive` gates the "Free masterclass" option, which the library
 * says to add to "Just exploring" only once T5 is switched on — offering a
 * masterclass we cannot name a date for is worse than not offering one.
 */
export function replyForTap(
  text: string,
  tokens: ReplyTokens,
  now: Date = new Date(),
  opts: { hours?: CallHours; masterclassLive?: boolean } = {},
): ReplyPlan {
  const hours = opts.hours ?? DEFAULT_CALL_HOURS;
  const spec = matchTap(text);
  const label = normaliseTap(spec?.label ?? text);
  const none: ReplyPlan = { text: "", buttons: [] };

  switch (label) {
    case "yes, call me now":
      return {
        text: callsWithinPromise(now, hours)
          ? `${thanks(tokens)} ${who(tokens)} will call you within ${CALL_NOW_MINUTES} minutes.`
          : `${thanks(tokens)} Our counsellors call between ${hoursPhrase(hours)}. ${who(tokens)} will call you as soon as we open.`,
        buttons: [],
      };

    case "yes, call me later":
      return {
        text: "Sure. When suits you best?",
        // "Later today" is dropped after 4 PM: offering a slot that can no
        // longer be honoured is the same broken promise as ignoring the tap.
        buttons: [
          ...(hourIn(now) < HIDE_LATER_TODAY_AFTER ? ["Later today"] : []),
          "Tomorrow morning", "Tomorrow afternoon",
        ],
      };

    case "call me later today":
    case "later today":
      return { text: `Done. ${who(tokens)} will call you before ${hour12(hours.endHour)} today.`, buttons: [] };

    case "call me tomorrow":
      return { text: "Sure. Morning or afternoon?", buttons: ["11 AM to 1 PM", "1 PM to 5 PM"] };

    case "tomorrow morning":
    case "11 am to 1 pm":
      return { text: `Done. ${who(tokens)} will call you tomorrow between 11 AM and 1 PM.`, buttons: [] };

    case "tomorrow afternoon":
    case "1 pm to 5 pm":
      return { text: `Done. ${who(tokens)} will call you tomorrow between 1 PM and 5 PM.`, buttons: [] };

    case "just exploring":
      return {
        text: "Makes sense. Here's an easy way to start.",
        buttons: [
          "Course details",
          // 20 characters, not the template's 21 — see the note at the top.
          "Remind me in 2 weeks",
          ...(opts.masterclassLive ? ["Free masterclass"] : []),
        ].slice(0, MAX_INTERACTIVE_BUTTONS),
      };

    case "chat on whatsapp":
      return {
        text: `Sure. Type your question here and ${whoLower(tokens)} will reply between ${hoursPhrase(hours)}.`,
        buttons: [],
      };

    case "request a callback":
    case "yes, keep it open":
      // Same thirty-minute promise as "call me now", so the same guard: at
      // 16:56 the callback lands tomorrow morning and saying "within 30
      // minutes" is a promise the task itself contradicts.
      return {
        text: callsWithinPromise(now, hours)
          ? `${thanks(tokens)} A counsellor will call you within ${CALL_NOW_MINUTES} minutes.`
          : `${thanks(tokens)} Our counsellors call between ${hoursPhrase(hours)}. A counsellor will call you as soon as we open.`,
        buttons: [],
      };

    case "send course details":
    case "course details": {
      const course = val(tokens.course);
      const link = val(tokens.course_link);
      // No link on file → say what we can rather than print a bare colon.
      if (!link) return { text: `${who(tokens)} will send the ${course || "course"} details shortly. Reply here with any question.`, buttons: [] };
      return { text: `Here are the ${course || "course"} details: ${link}. Reply here with any question.`, buttons: [] };
    }

    case "how the refund works":
      return {
        text: "If you complete the programme and placement requirements but don't get a qualifying job within 6 months, you can claim back 50% of your fee. Full terms: analytixlabs.co.in/placements",
        buttons: [],
      };

    case "book a centre visit": {
      const addr = val(tokens.centre_address);
      return {
        text: addr
          ? `Great. ${who(tokens)} will call you to fix a time. Address: ${addr}`
          : `Great. ${who(tokens)} will call you to fix a time.`,
        buttons: [],
      };
    }

    case "share fees and emi":
      return { text: `${who(tokens)} will share the fees and EMI options for ${val(tokens.course) || "your course"} shortly.`, buttons: [] };

    case "register me":
    case "free masterclass": {
      const topic = val(tokens.masterclass_topic);
      const date = val(tokens.masterclass_date);
      const time = val(tokens.masterclass_time);
      const link = val(tokens.join_link);
      // Registration is on hold for want of a schedule. Without one, say so
      // rather than sending "You're in.  at . Join here:".
      if (!topic || !date || !time) {
        return { text: `${thanks(tokens)} ${who(tokens)} will send you the masterclass details shortly.`, buttons: [] };
      }
      return {
        text: `You're in. ${topic}, ${date} at ${time}.${link ? ` Join here: ${link}` : ""}`,
        buttons: [],
      };
    }

    case "not this time":
      return { text: "No problem. Reply here anytime if you have a question.", buttons: [] };

    case "check back in 2 weeks":
    case "remind me in 2 weeks":
      return { text: "No problem. We'll check back in 2 weeks.", buttons: [] };

    case "close my enquiry":
      // The library's line, plus the way back in — a lead who closes by
      // mistake must not be left with no route to reopen.
      return { text: "Done. We've closed your enquiry and won't message you again. Reply START if you change your mind.", buttons: [] };

    default:
      // A typed reply, not a tap. A counsellor is being told; sending an
      // automated "thanks" on top of that is noise, and risks answering a
      // real question with a platitude.
      return none;
  }
}

/**
 * Every button this module can ever send, checked against Meta's limits.
 *
 * Exported so a test can walk it. Three ways a button fails silently: too
 * long (truncated, then matches nothing), duplicated within one message
 * (Meta refuses the send), or not in the tap router at all (the reply does
 * nothing when pressed).
 */
export function replyButtonProblems(plans: ReplyPlan[]): string[] {
  const problems: string[] = [];
  for (const p of plans) {
    if (p.buttons.length > MAX_INTERACTIVE_BUTTONS) {
      problems.push(`"${p.text.slice(0, 30)}…" offers ${p.buttons.length} buttons; WhatsApp shows at most ${MAX_INTERACTIVE_BUTTONS}`);
    }
    if (new Set(p.buttons.map(normaliseTap)).size !== p.buttons.length) {
      problems.push(`"${p.text.slice(0, 30)}…" repeats a button title, which Meta refuses`);
    }
    for (const b of p.buttons) {
      if (b.length > INTERACTIVE_BUTTON_CHARS) {
        problems.push(`"${b}" is ${b.length} characters — over the ${INTERACTIVE_BUTTON_CHARS}-character interactive button limit`);
      }
      if (!matchTap(b)) {
        problems.push(`"${b}" is not in RNR_TAPS, so pressing it would do nothing`);
      }
    }
  }
  return problems;
}
