// The RNR journey, written down once.
//
// Nine templates and a four-week schedule, transcribed from the RNR WhatsApp
// Message Library (30 September 2026). Building that by hand in the portal
// means typing nine template names, seven delays and three audience rules
// with no editor for two of them — and getting one button label wrong
// silently breaks the routing for that step forever.
//
// ── Phases ─────────────────────────────────────────────────────────────────
//
// T1 and T2 belong to Phase 1, while counsellors are still calling. They are
// defined here so they can be submitted, but they are NOT part of the drip:
// the agreed flow has a counsellor sending a personal message from their own
// line on days 1 and 2, and the drip starting only at Not Reachable.
//
// T3–T9 are the drip. Two of them are on hold for want of a data source, and
// a held step is left OUT of the sequence rather than sent with a blank.
//
// ── What this does NOT do ──────────────────────────────────────────────────
//
// Submitting to Meta is a separate, deliberate call. templateDrafts() builds
// the exact payloads; the route decides whether to send them.

import { RNR_TAPS, normaliseTap } from "./rnrtaps";
import type { AudienceRule } from "./seqaudience";
import type { CreateTemplateInput } from "./whatsapp";
import {
  CTC_COURSE_VALUES, ROLE_COURSE_VALUES, CLASSROOM_COURSE_VALUES, CENTRE_CITIES,
} from "./leadtokens";

const DAY = 24 * 60;

/** The tag a masterclass registration writes, so R+5 skips those already in. */
export const MASTERCLASS_TAG = "masterclass-registered";

/**
 * Meta's quick-reply limit, confirmed against the published docs.
 *
 * An earlier pass here used 20 and shortened the brief's "Check back in 2
 * weeks" on that basis. That was wrong — the limit is 25, the label was
 * always valid, and createTemplate's own slice has said 25 all along.
 */
export const MAX_BUTTON_CHARS = 25;

export type TemplatePhase = "calling" | "drip";

export interface RnrTemplate {
  id: string;                    // T1…T9, as the library numbers them
  key: string;
  phase: TemplatePhase;
  /**
   * Days after the Not Reachable marking. Null for the Phase 1 messages.
   *
   * ── Why these are not the numbers in the brief ───────────────────────────
   *
   * The library asks for the drip to open the day after the lead is marked
   * Not Reachable, and the day after that. With the counsellor's two messages
   * landing on the two days before, that is FOUR marketing templates on four
   * consecutive days:
   *
   *     day 1  Message A      day 3  R+1  about us
   *     day 2  Message B      day 4  R+2  course and roles
   *
   * Every RNR template is category MARKETING, and Meta caps how many
   * marketing messages one person receives — error 131049, "not delivered to
   * maintain healthy ecosystem engagement". It dropped three of five on the
   * 1 October test run. That run was two minutes apart so it proves nothing
   * on its own, but four in four days is the same shape, and when the cap
   * bites the message is simply gone: the lead sees nothing, no failure
   * reaches the portal, and the journey moves on as though it had sent.
   *
   * So the drip opens on day 3 and widens from there — 3, 7, 12, 18, 28, with
   * gaps of 3, 4, 5, 6 and 10 days. It still ends four weeks out, which is
   * the part of the brief that carries meaning, and a taper reads better to
   * somebody who is not answering than a burst does.
   *
   * The two held templates (T5, T8) keep days that preserve the ascending
   * order, because buildSteps subtracts each day from the one before and a
   * day out of sequence silently becomes a zero-minute wait.
   */
  day: number | null;
  templateName: string;
  /** Body with {{n}} where Meta wants a variable. */
  body: string;
  /** What each {{n}} is, as a token leadtokens.ts can resolve. */
  params: string[];
  /** Meta requires a sample for every variable or it rejects the template. */
  exampleValues: string[];
  buttons: string[];
  audience: AudienceRule | null;
  /** Why this step is not for everybody, in one line. */
  note?: string;
  /**
   * What is missing before this can send. Null means ready.
   *
   * A held template can still be SUBMITTED — approval takes time and there
   * is no reason to wait — but it is left out of the sequence, because the
   * only alternative is sending it with a blank where the date goes.
   */
  hold: string | null;
}

export interface RnrSeedOptions {
  /** The number these go out from. PPC SM — the templates are approved there. */
  channelId: string;
  /** CRM attribute holding the enquired course. LeadSquared's name, not ours. */
  courseAttr?: string;
  /** CRM attribute holding the lead's city. */
  cityAttr?: string;
  /** Local hours the drip may send in. The brief says 10 AM to 8 PM. */
  sendStartHour?: number;
  sendEndHour?: number;
  languageCode?: string;
  /** Include a held template in the sequence anyway. For a test, not for leads. */
  includeHeld?: boolean;
}

/**
 * Every template in the library, in order.
 *
 * Bodies are transcribed exactly, with the library's named placeholders
 * turned into Meta's positional {{n}} and the name kept alongside in
 * `params` — positional because bodyParameters() already handles it, and the
 * named form needs a different payload that has bitten this codebase before.
 */
export function rnrTemplates(o: RnrSeedOptions): RnrTemplate[] {
  // What LeadSquared actually calls these fields on this instance. Checked
  // against the live contacts: 118 carry "Product Name", ~200 carry "city",
  // and nothing at all carries "course" — a rule keyed on "course" would
  // have matched nobody and skipped R+2, R+10 and R+15 for every lead.
  const courseAttr = o.courseAttr?.trim() || "Product Name";
  const cityAttr = o.cityAttr?.trim() || "city";

  return [
    // ── Phase 1 · while counsellors are still calling ────────────────────
    {
      id: "T1", key: "missed_call", phase: "calling", day: null,
      templateName: "rnr_01_missed_call",
      body: "Hi {{1}}, this is {{2}} from AnalytixLabs. We just tried calling you about your enquiry.\n\nAre you looking to start or grow your career in Data Science, Analytics or AI? Our courses come with dedicated placement support.",
      params: ["{first_name}", "{counsellor_name}"],
      exampleValues: ["Rahul", "Neha"],
      buttons: ["Yes, call me now", "Yes, call me later", "Just exploring"],
      audience: null, hold: null,
      note: "Phase 1 — not part of the drip.",
    },
    {
      id: "T2", key: "call_retry", phase: "calling", day: null,
      templateName: "rnr_02_call_retry",
      body: "Hi {{1}}, {{2}} from AnalytixLabs again. We tried calling you about your {{3}} enquiry.\n\nIf calls are hard right now, pick a time below, or just reply here.",
      params: ["{first_name}", "{counsellor_name}", "{course}"],
      exampleValues: ["Rahul", "Neha", "Data Analytics"],
      buttons: ["Call me later today", "Call me tomorrow", "Chat on WhatsApp"],
      audience: null, hold: null,
      note: "Phase 1 — not part of the drip.",
    },

    // ── Phase 2 · the drip, from Not Reachable ───────────────────────────
    {
      id: "T3", key: "about_us", phase: "drip", day: 3,
      templateName: "rnr_03_about_us",
      body: "Hi {{1}}, greetings from AnalytixLabs.\n\nSince 2011, we have helped 20,000+ learners build careers in data and AI. Depending on the course, you can learn online, in a classroom at our Bangalore and Delhi NCR centres, or a mix of both.\n\nCan we help you find the right course?",
      params: ["{first_name}"],
      exampleValues: ["Rahul"],
      buttons: ["Request a callback", "Chat on WhatsApp"],
      audience: null, hold: null,
    },
    {
      id: "T4", key: "course_roles", phase: "drip", day: 7,
      templateName: "rnr_04_course_roles",
      body: "Hi {{1}}, our {{2}} course prepares you for roles like {{3}} and {{4}}. You learn through hands-on projects, and our placement team supports you at the end.",
      params: ["{first_name}", "{course}", "{role_1}", "{role_2}"],
      exampleValues: ["Rahul", "Data Analytics", "Data Analyst", "Business Analyst"],
      buttons: ["Send course details", "Request a callback"],
      // The library says "Everyone", but its own roles table has no pair for
      // AI for Managers — it says those managers are not changing role.
      // There is no honest sentence for them, so they are left out rather
      // than sent two invented job titles.
      audience: { attrIn: { [courseAttr]: [...ROLE_COURSE_VALUES] } },
      note: "Only courses with a confirmed role pair. AI for Managers has none.",
      hold: null,
    },
    {
      id: "T5", key: "masterclass", phase: "drip", day: 10,
      templateName: "rnr_05_masterclass",
      body: "Not sure yet? See how we teach first.\n\nJoin our free live masterclass, {{1}}, on {{2}} at {{3}}. No cost, no commitment.",
      params: ["{masterclass_topic}", "{masterclass_date}", "{masterclass_time}"],
      exampleValues: ["Excel to AI", "Sunday 11 October", "11 AM"],
      buttons: ["Register me", "Not this time"],
      audience: { lacksTag: [MASTERCLASS_TAG] },
      note: "Skips leads already registered.",
      hold: "No masterclass schedule source yet — topic, date and time cannot be filled.",
    },
    {
      id: "T6", key: "results", phase: "drip", day: 12,
      templateName: "rnr_06_results",
      body: "Our learners' results, in numbers:\n• 90%+ placement\n• 40% average salary hike\n• {{1}} minimum CTC on your programme\n• 50% fee refund if not placed within 6 months\n\nConditions apply.",
      params: ["{min_ctc}"],
      exampleValues: ["₹6 lakh"],
      buttons: ["How the refund works", "Request a callback"],
      audience: { attrIn: { [courseAttr]: [...CTC_COURSE_VALUES] } },
      note: "Only programmes that carry these terms. Not GenAI, Agentic AI, Business Analytics or AI for Managers.",
      hold: null,
    },
    {
      id: "T7", key: "centre_visit", phase: "drip", day: 18,
      templateName: "rnr_07_centre_visit",
      body: "Prefer learning face to face? Our {{1}} centre runs classroom batches for {{2}}. Walk in to meet a counsellor and see the classroom.",
      params: ["{centre_name}", "{course}"],
      exampleValues: ["Gurgaon", "Data Analytics"],
      buttons: ["Book a centre visit", "Request a callback"],
      audience: {
        attrIn: { [cityAttr]: [...CENTRE_CITIES], [courseAttr]: [...CLASSROOM_COURSE_VALUES] },
      },
      note: "Bangalore and NCR only, and only the three classroom courses.",
      hold: null,
    },
    {
      id: "T8", key: "next_batch", phase: "drip", day: 24,
      templateName: "rnr_08_next_batch",
      body: "Hi {{1}}, our next {{2}} batch starts on {{3}}. EMI options are available.",
      params: ["{first_name}", "{course}", "{batch_date}"],
      exampleValues: ["Rahul", "Data Analytics", "Monday 2 November"],
      buttons: ["Share fees and EMI", "Request a callback"],
      audience: null,
      hold: "No batch date source yet — {batch_date} cannot be filled.",
    },
    {
      id: "T9", key: "keep_or_close", phase: "drip", day: 28,
      templateName: "rnr_09_keep_or_close",
      body: "Hi {{1}}, we haven't been able to connect yet. Should we keep your enquiry open?",
      params: ["{first_name}"],
      exampleValues: ["Rahul"],
      buttons: ["Yes, keep it open", "Check back in 2 weeks", "Close my enquiry"],
      audience: null, hold: null,
    },
  ];
}

/** The drip steps that can actually send today, in order. */
export function rnrSteps(o: RnrSeedOptions): RnrTemplate[] {
  return rnrTemplates(o)
    .filter(t => t.phase === "drip")
    .filter(t => o.includeHeld || !t.hold);
}

/** The drip steps left out, and why — so the omission is reported, not silent. */
export function heldSteps(o: RnrSeedOptions): RnrTemplate[] {
  return rnrTemplates(o).filter(t => t.phase === "drip" && t.hold);
}

/**
 * Every button label must be one the router knows, and short enough to
 * arrive intact — plus the three ways Meta rejects a submission.
 *
 * A template quick-reply comes back as its own text, so a label that is not
 * in RNR_TAPS routes to nothing: the drip keeps running, the tap does
 * nothing, and no error is raised anywhere.
 */
export function validateButtons(templates: RnrTemplate[]): string[] {
  const known = new Set(RNR_TAPS.map(t => normaliseTap(t.label)));
  const problems: string[] = [];
  for (const s of templates) {
    for (const b of s.buttons) {
      if (!known.has(normaliseTap(b))) {
        problems.push(`${s.templateName}: "${b}" is not in RNR_TAPS, so a tap on it would route to nothing`);
      }
      if (b.length > MAX_BUTTON_CHARS) {
        problems.push(`${s.templateName}: "${b}" is ${b.length} characters — over Meta's ${MAX_BUTTON_CHARS}-character quick-reply limit`);
      }
    }
    if (new Set(s.buttons.map(normaliseTap)).size !== s.buttons.length) {
      problems.push(`${s.templateName}: two buttons share the same text, which Meta rejects`);
    }
    // Meta rejects a body that opens or closes on a variable.
    const body = s.body.trim();
    if (/^\{\{\d+\}\}/.test(body)) problems.push(`${s.templateName}: the body starts with a variable, which Meta rejects`);
    if (/\{\{\d+\}\}$/.test(body)) problems.push(`${s.templateName}: the body ends with a variable, which Meta rejects`);
    // Every {{n}} needs a sample, and a token to fill it from.
    const vars = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]));
    if (vars.size !== s.exampleValues.length) {
      problems.push(`${s.templateName}: ${vars.size} variable(s) but ${s.exampleValues.length} sample(s) — Meta needs one each`);
    }
    if (vars.size !== s.params.length) {
      problems.push(`${s.templateName}: ${vars.size} variable(s) but ${s.params.length} param token(s)`);
    }
  }
  return problems;
}

/** The engine wants each step's wait from the previous one, not from day 0. */
export function buildSteps(steps: RnrTemplate[], languageCode = "en_US"): {
  delayMinutes: number;
  action: { type: "template"; templateName: string; languageCode: string; params: string[] };
  audience: AudienceRule | null;
}[] {
  let previousDay = 0;
  return steps.map(s => {
    const day = s.day ?? 0;
    const delayMinutes = Math.max(0, day - previousDay) * DAY;
    previousDay = day;
    return {
      delayMinutes,
      action: { type: "template" as const, templateName: s.templateName, languageCode, params: s.params },
      audience: s.audience,
    };
  });
}

/** The payloads to submit to Meta, built from the same copy the steps use. */
export function templateDrafts(templates: RnrTemplate[], languageCode = "en_US"): CreateTemplateInput[] {
  return templates.map(s => ({
    name: s.templateName,
    language: languageCode,
    category: "MARKETING" as const,
    bodyText: s.body,
    exampleValues: s.exampleValues,
    buttons: s.buttons.map(text => ({ type: "QUICK_REPLY" as const, text })),
  }));
}

/** The sequence's own settings, as the brief and the meeting agreed them. */
export function rnrSequenceSettings(o: RnrSeedOptions) {
  return {
    name: "RNR follow-up",
    channelId: o.channelId,
    platform: "whatsapp" as const,
    triggerKind: "manual" as const,      // driven by the stage-drip mapping, not a keyword
    team: "sales" as const,
    aidaStage: "interest" as const,
    stopOnReply: true,                   // any tap or reply stops it
    sendStartHour: o.sendStartHour ?? 10,
    sendEndHour: o.sendEndHour ?? 20,
    maxPerDay: 1,                        // "one message per day at most"
    skipIfRecentReplyDays: 3,            // "tapped A or B but still RNR → skip"
  };
}
