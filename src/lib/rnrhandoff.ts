import { recordSequenceSend } from "./dripstore";
import { DEFAULT_TENANT_ID } from "./tenant";
// Carrying out the plan a tap produces.
//
// rnrtaps.ts decides WHAT should happen; this does it. Split that way because
// the deciding is pure and worth testing exhaustively, while the doing is four
// network calls to three systems, any of which can fail without the others
// mattering.
//
// ── Everything here is best-effort, on purpose ──────────────────────────────
//
// This runs inside the WhatsApp webhook. Meta retries a webhook it does not
// get a fast 200 from, and a retried inbound would re-run every one of these.
// So nothing here is allowed to throw: a CRM that is down must not turn a
// delivered message into a redelivered one, and must never stop the portal
// recording that the lead replied.
//
// The one thing that is NOT best-effort is stopping the drip. That happens
// first, before any network call that could fail, because continuing to
// message somebody who just answered is the failure this whole feature exists
// to prevent.

import { planForTap, type TapPlan } from "./rnrtaps";
import { stopAllEnrollments } from "./sequences";
import {
  addOptout, getContactByPhoneLoose, getConversationByPhone,
  appendConvMessage, touchOutbound, 
} from "./store";
import { ensureLead, createLeadTask } from "./leadsquared";
import { recordDripEvent, replyLine } from "./driplog";
import { leadTokens, firstName } from "./leadtokens";
import { replyForTap } from "./rnrreplies";
import { sendText, sendButtons, sendList } from "./whatsapp";
import { setContactAttributes } from "./store";
import { coursePicks, matchCoursePick, needsCourse, COURSE_PROMPT, COURSE_BUTTON } from "./coursepick";
import type { ChannelCreds } from "./channels";

export interface HandoffResult {
  plan: TapPlan;
  stopped: number;
  optedOut: boolean;
  taskCreated: boolean;
  activityQueued: boolean;
  fieldWritten: boolean;
  /** What the lead saw back, if anything. Empty for a typed reply. */
  replySent: string;
}

/**
 * The LeadSquared field that captures a drip response, kept apart from the
 * ordinary WhatsApp chat log so a workflow can fire on it alone.
 *
 * Agreed in the 29 September meeting and named by Sabrish. Configured rather
 * than hardcoded because the schema name (mx_Something, not the label shown
 * in the UI) comes from their instance, and a wrong attribute returns HTTP
 * 200 with nothing changed — the quietest failure LeadSquared offers.
 *
 * Unset means the write is skipped entirely, so this ships and sits inert
 * until the field exists rather than logging an error on every tap.
 */
export const RNR_RESPONSE_FIELD = () => (process.env.LSQ_RNR_RESPONSE_FIELD ?? "").trim();

/**
 * How much of the response the CRM field can hold.
 *
 * mx_RNR_DRIP_LOGS is a LeadSquared Text field with MaxLength 256, which is
 * the default for the type. The longest thing we write is a typed reply —
 * "Replied on WhatsApp: " plus 200 characters of their message, so 221 — and
 * it fits today. It would not survive somebody lengthening that prefix, and
 * LeadSquared's answer to an over-long value is HTTP 200 with nothing
 * changed, which is the failure nobody notices.
 *
 * Truncated here rather than in setLeadField: 256 is this field's limit, not
 * every field's, and a generic cap would quietly shorten a longer one.
 */
export const RNR_RESPONSE_MAX = 256;

/**
 * A lead replied or tapped. Stop talking to them and hand them to a human.
 *
 * `phone` is the lead's number; `text` is the inbound body, which for a
 * template quick-reply is the button's own label.
 *
 * Returns what actually happened rather than throwing, so the webhook can log
 * a partial handoff (drip stopped, CRM unreachable) as the useful thing it is
 * instead of losing the whole record to one failed call.
 */
/**
 * How long after a counsellor's nudge a reply still belongs to the campaign.
 *
 * It has to be long enough for a real answer — a student nudged on Friday
 * writes back on Monday — and short enough that the campaign ends. Without a
 * limit, a lead nudged once in October would have every message they ever
 * sent filed as a drip reply, which is the contamination this split was
 * introduced to stop.
 *
 * Fourteen days: twice the gap the nudge pair itself spans, and well inside
 * the 28-day drip. After that the counsellor has either spoken to them or
 * given up, and whatever they write is an ordinary conversation.
 */
export const NUDGE_REPLY_WINDOW_MS = 14 * 24 * 60 * 60_000;

/** The nudge stamps a counsellor's send leaves on the contact. */
const NUDGE_ATTRS = ["rnr_nudge_a_at", "rnr_nudge_b_at"] as const;

/**
 * Is this message part of the RNR campaign, or ordinary conversation?
 *
 * The drip log is for what the campaign provoked; everything else belongs on
 * the WhatsApp activity timeline. Three things put a message in the first
 * group, and nothing else does:
 *
 *   stopped > 0            they were mid-journey and this reply ended it.
 *                          Taken from the count in step 1, because by now the
 *                          enrolment is stopped and asking the database would
 *                          say no for exactly the person this is about.
 *
 *   a matched TAP          they pressed a button a campaign message put in
 *                          front of them. intent "reply" means matchTap found
 *                          nothing, i.e. somebody typed to us.
 *
 *   a recent NUDGE         ← added 15 Oct. A counsellor pressing "Send
 *                          WhatsApp" in LeadSquared creates no enrolment, it
 *                          sends the template and stamps the contact. So a
 *                          lead nudged that way who TYPES rather than taps
 *                          matched neither test above, and their reply was
 *                          recorded nowhere — no drip log, no CRM field, no
 *                          task. Sanjay Sah replied to a nudge on 13 Oct with
 *                          "Sorry still not required but in future it would
 *                          be then I will contact"; the portal had it and
 *                          LeadSquared's field was null. Students type, so
 *                          this was most of the real traffic.
 *
 * Reads the contact only when the cheap tests have already failed, so the
 * ordinary inbound message — which is every message from every visitor —
 * costs nothing extra.
 */
async function partOfTheCampaign(phone: string, plan: TapPlan, stopped: number, now: Date, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  if (stopped > 0 || plan.intent !== "reply") return true;
  try {
    const contact = await getContactByPhoneLoose(phone, tenantId);
    const attrs = (contact?.attributes ?? {}) as Record<string, string>;
    return NUDGE_ATTRS.some(a => {
      const at = Date.parse(attrs[a] ?? "");
      return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at <= NUDGE_REPLY_WINDOW_MS;
    });
  } catch {
    // A contact we cannot read is not evidence of a campaign. Staying out of
    // the drip log is the safe direction: the message is still on the
    // timeline and in the inbox, it is simply not claimed as a drip reply.
    return false;
  }
}

export async function handleLeadResponse(
  phone: string,
  text: string,
  // `channel` carries an optional id because the webhook hands us the full
  // Channel row: the id is what stamps the chat log with the number this
  // conversation actually happened on.
  opts: { channel?: ChannelCreds & { id?: string }; now?: Date; masterclassLive?: boolean } = {},tenantId = DEFAULT_TENANT_ID
): Promise<HandoffResult> {
  const plan = planForTap(text, opts.now ?? new Date());

  // 1. Stop first. Before the CRM, before the opt-out write, before anything
  //    that talks to another system — because every one of those can fail and
  //    none of them is a reason to keep drip-feeding somebody who answered.
  let stopped = 0;
  try {
    stopped = await stopAllEnrollments(phone, tenantId);
  } catch (e) {
    console.error(JSON.stringify({ tag: "rnr_stop_failed", phone: phone.slice(-4), error: String(e) }));
  }

  // 2. "Close my enquiry" means never again, and is treated exactly like an
  //    inbound STOP so there is one suppression list rather than two.
  let optedOut = false;
  if (plan.optOut) {
    try {
      await addOptout(phone, "tapped Close my enquiry", tenantId);
      optedOut = true;
    } catch (e) {
      console.error(JSON.stringify({ tag: "rnr_optout_failed", phone: phone.slice(-4), error: String(e) }));
    }
  }

  // 3. The CRM half.
  //
  //    The lead's response goes into the drip log field, NOT onto the main
  //    WhatsApp activity timeline (decided 1 October): the drip conversation
  //    is kept apart so the timeline stays the record of what a human did.
  //    The task is what actually reaches a counsellor, and needs a lead id.
  let taskCreated = false;

  // ── Only a DRIP conversation belongs in the drip log ──────────────────────
  //
  // This used to record every inbound message, because handleLeadResponse runs
  // on every inbound. The result was mx_RNR_DRIP_LOGS filling up with ordinary
  // chat — "Hi! I'd like to learn more about the courses", "Live Online",
  // "Know more about Courses" — from leads who had never been in a drip at
  // all. Seen on the live field, 14 Oct.
  //
  // The agreed split is the other way round: ordinary conversation belongs on
  // the WhatsApp activity timeline, and the drip log is for what the drip
  // itself provoked. A log that holds everything answers nothing.
  //
  // What counts as part of the campaign now lives in partOfTheCampaign above,
  // with the reasoning for each of its three tests.

  // ── Did they just answer "which programme?" ─────────────────────────────
  //
  // Checked first, because everything below reads the contact and this is
  // the one message that changes what it says. A list reply arrives as the
  // row's TITLE, so the match is on the text — see coursepick.ts.
  //
  // Stored fill-if-empty like every other course write: if they already had
  // a usable one we would not have asked.
  let coursePicked: string | null = null;
  const picked = matchCoursePick(text);
  if (picked) {
    const held = await getContactByPhoneLoose(phone, tenantId).catch(() => null);
    if (needsCourse(held?.attributes as Record<string, string> | undefined)) {
      await setContactAttributes(held?.phone ?? phone, { "Product Name": picked }, tenantId).catch(() => undefined);
      coursePicked = picked;
    }
  }

  // ── One writer for the CRM field ────────────────────────────────────────
  //
  // recordDripEvent appends to our own copy and then overwrites
  // mx_RNR_DRIP_LOGS with the WHOLE rendered conversation — deliberately,
  // because LeadSquared's reads lag its writes and a read-modify-write would
  // lose lines. It therefore already writes the field, and the separate
  // setLeadField that used to follow wrote the SAME field again with a single
  // activity line, replacing the thread with the last line of it.
  //
  // It stayed invisible while typed replies were being dropped altogether:
  // the only messages reaching either writer were button taps, where the log
  // is one line anyway and the two look alike. Fixing the gate above is what
  // would have exposed it, on the first lead who sent two messages.
  //
  // Awaited rather than fired and forgotten, for the ordering the task
  // depends on: the LeadSquared workflow that nudges a counsellor keys off
  // this field, so a task raised before the field is written arrives without
  // the context that explains it.
  const fromDrip = await partOfTheCampaign(phone, plan, stopped, opts.now ?? new Date(), tenantId);
  let fieldWritten = false;
  if (fromDrip) {
    fieldWritten = await recordDripEvent(phone, replyLine(opts.now ?? new Date(), text), tenantId)
      .catch(() => false);
  }
  const activityQueued = true;

  // The dedicated response field. Written BEFORE the task, because the
  // workflow that nudges a counsellor keys off this field — a task raised
  // first would arrive without the context that explains it.
  const field = RNR_RESPONSE_FIELD();

  // ── Only for somebody who was actually being nurtured ────────────────────
  //
  // This runs on EVERY inbound message, and planForTap returns a callback task
  // for any text it does not recognise — which is every "hi" from every new
  // visitor. So ensureLead was creating the CRM lead for first-time strangers,
  // with no name and no source, and doing it at the top of the webhook before
  // the tracked-link attribution had even been read.
  //
  // The lead was therefore born as Source "WhatsApp" with no name, and Source
  // and Owner are deliberately never rewritten on a lead that already exists —
  // so the real ppc-wa-* label could never land afterwards. Paid attribution
  // stopped dead on 29 September at 16:17 IST, the minute this shipped.
  //
  // The handoff is for "a lead who was being nurtured has answered". A reply
  // from somebody no journey was ever talking to is an ordinary inbound, and
  // belongs to the inbox. So: act when we actually stopped a journey, or when
  // the text matched a real RNR button — never on an unrecognised first hello.
  const wasNurtured = fromDrip;

  if (wasNurtured && (plan.task || field)) {
    try {
      const leadId = await ensureLead(phone, undefined, undefined, tenantId);
      if (leadId) {
        // The field is NOT written here — recordDripEvent above owns it, and
        // writing it twice replaced the conversation with one line of itself.
        if (plan.task) {
          taskCreated = await createLeadTask(leadId, {
            name: plan.task.name,
            notes: plan.task.notes,
            dueDate: plan.task.dueAt,
          }, tenantId);
        }
      }
    } catch (e) {
      console.error(JSON.stringify({ tag: "rnr_crm_failed", phone: phone.slice(-4), error: String(e) }));
    }
  }

  // 4. Answer them.
  //
  //    Until this existed a lead pressed "Yes, call me now" and their screen
  //    did nothing. A button that appears to do nothing is a button nobody
  //    presses twice, and it is the cheapest possible way to lose a lead who
  //    had just put their hand up.
  //
  //    These are ordinary chat messages: the tap itself opened the 24-hour
  //    window, so no template and no approval are involved. Last, and
  //    best-effort, because the drip is already stopped and the counsellor
  //    already alerted — a failed courtesy must not undo either.
  let replySent = "";
  try {
    const [contact, conv] = await Promise.all([
      getContactByPhoneLoose(phone, tenantId).catch(() => null),
      getConversationByPhone(phone, tenantId).catch(() => null),
    ]);
    const tokens = {
      ...leadTokens(contact),
      // The counsellor is whoever owns the chat. Missing is normal and
      // handled: the sentences fall back to "A counsellor" rather than
      // printing a blank.
      counsellor_name: firstName(conv?.assignedTo ?? ""),
    };
    // ── Ask which programme, when nothing else can tell us ──────────────
    //
    // Only for somebody the drip was actually talking to, and only when we
    // genuinely do not know. Three of the five steps are addressed by the
    // course and LeadSquared holds a usable one for none of these leads, so
    // without this they receive day 3 and day 28 and nothing in between.
    //
    // Sent AFTER the acknowledgement, never instead of it: a lead who asked
    // for a callback gets told the callback is coming, and only then gets
    // the question. Reversing those two reads as a form standing between
    // them and the thing they asked for.
    //
    // No template needed — their own message opened the 24-hour window.
    const askCourse = wasNurtured && !coursePicked
      && needsCourse(contact?.attributes as Record<string, string> | undefined);

    const reply = replyForTap(text, tokens, opts.now ?? new Date(), { masterclassLive: opts.masterclassLive });
    if (reply.text) {
      const r = reply.buttons.length
        ? await sendButtons(phone, reply.text, reply.buttons.map((title, i) => ({ id: `rnr_${i + 1}`, title })), opts.channel)
        : await sendText(phone, reply.text, opts.channel);
      if (r.error) {
        console.error(JSON.stringify({ tag: "rnr_reply_failed", phone: phone.slice(-4), error: r.error }));
      } else {
        replySent = reply.text;
        // ── Write it down, or nobody can tell it happened ────────────────
        //
        // The first live tap produced silence in Live Chat: the lead's
        // "Request a callback" was there, and nothing after it. The reply
        // may well have been delivered — there was simply no record either
        // way, which is indistinguishable from the send having failed.
        //
        // A counsellor opening this chat has to see what the lead was
        // already told, or they open by repeating it. And the send log
        // gives Meta's delivery callback something to match, exactly as a
        // drip send now does.
        const logged = reply.buttons.length ? `${reply.text}\n[buttons: ${reply.buttons.join(" | ")}]` : reply.text;
        if (conv?.id) {
          await appendConvMessage({ tenantId, 
            conversationId: conv.id, role: "assistant", body: logged,
            metaId: r.id ?? null, source: "bot", channelId: opts.channel?.id ?? null,
          }).catch(() => undefined);
          await touchOutbound(conv.id, logged).catch(() => undefined);
        }
        await recordSequenceSend({ tenantId,  phone, name: contact?.name ?? null, metaMessageId: r.id ?? null }, tenantId);
      }
    }

    // The question, last of all. A failure here costs the course and nothing
    // else — the acknowledgement is already sent and the counsellor already
    // alerted, and neither should be undone by a list that did not render.
    if (askCourse) {
      const picks = coursePicks();
      if (picks.length) {
        const lr = await sendList(
          phone, COURSE_PROMPT, COURSE_BUTTON,
          [{ title: "Programmes", rows: picks.map(x => ({ id: x.crmName.slice(0, 200), title: x.title })) }],
          opts.channel,
        );
        if (lr.error) {
          console.error(JSON.stringify({ tag: "rnr_course_ask_failed", phone: phone.slice(-4), error: lr.error }));
        } else if (conv?.id) {
          // Logged like any other outbound, or a counsellor opening the chat
          // sees the lead answer a question nobody appears to have asked.
          await appendConvMessage({ tenantId, 
            conversationId: conv.id, role: "assistant",
            body: `${COURSE_PROMPT}\n[list: ${picks.map(x => x.title).join(" | ")}]`,
            metaId: lr.id ?? null, source: "bot", channelId: opts.channel?.id ?? null,
          }).catch(() => undefined);
          await touchOutbound(conv.id, COURSE_PROMPT).catch(() => undefined);
        }
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ tag: "rnr_reply_failed", phone: phone.slice(-4), error: String(e) }));
  }

  // One structured line per handoff. This is the only record that ties a tap
  // to what the portal did about it, and the first thing anybody will want
  // when a counsellor says "nobody told me".
  console.log(JSON.stringify({
    tag: "rnr_handoff", intent: plan.intent, stopped,
    optedOut, taskCreated, fieldWritten, fieldConfigured: !!field,
    replied: !!replySent, phone: phone.slice(-4),
  }));

  return { plan, stopped, optedOut, taskCreated, activityQueued, fieldWritten, replySent };
}
