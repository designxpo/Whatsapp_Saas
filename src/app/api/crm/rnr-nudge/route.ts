import { recordSequenceSend } from "@/lib/dripstore";
import { apiKeyTenant } from "@/lib/apiauth";
import { guardFeature, guardAccount } from "@/lib/feature-guard";
// The "Send WhatsApp" button on the LeadSquared lead page.
//
// A counsellor rings a lead, nobody answers, they press one button. This
// decides whether that means Message A, Message B, or nothing at all, and
// then does it.
//
// ── Why the decision is here and not in LeadSquared ────────────────────────
//
// Every condition in the brief's table depends on something LeadSquared
// cannot see: whether a message already went today, whether the lead wrote
// back, whether the number is even on WhatsApp. A custom action that made
// the counsellor pick a template would get it wrong on the second press of
// the day, every day. So the button carries no choice — it carries the lead.
//
// ── Wiring (LeadSquared → Custom Lead Actions Connector) ───────────────────
//
//   Invocation  CallAPI, POST, application/json
//   URL         https://<host>/api/crm/rnr-nudge
//   Header      x-crm-token: <CRM_API_KEY>
//   Body        { "phone":      "@{Lead:Phone,}",
//                 "leadId":     "@{Lead:ProspectID,}",
//                 "counsellor": "@{Lead:OwnerIdName,}",
//                 "name":       "@{Lead:FirstName,}" }
//
// `counsellor` matters more than it looks: Messages A and B both name the
// counsellor, and our contact records do not hold one. LeadSquared does, and
// mail-merge hands it over at the moment of the click.
//
// Replies are written for whoever pressed the button. A counsellor who sees
// nothing happen is owed a sentence, and "they replied an hour ago" and "you
// have already sent today" lead to different next actions.

import { NextResponse, after } from "next/server";
import {
  upsertContacts, getContactByPhoneLoose, getConversationByPhone,
  setContactAttributes, isOptedOut, getOrCreateConversation,
  appendConvMessage, touchOutbound,
} from "@/lib/store";
import { sendTemplateSingle } from "@/lib/whatsapp";
import { credsFor, getChannel, displayNumberFor } from "@/lib/channels";
import { listSequences } from "@/lib/sequences";
import { pushWaActivity } from "@/lib/leadsquared";
import { leadTokens, missingTokens, firstName } from "@/lib/leadtokens";
import { rnrTemplates } from "@/lib/rnrseed";
import { decideNudge, attrFor } from "@/lib/rnrnudge";
import { resolveCannedParams } from "@/lib/canned";


import { crmPreflight, withCrmCors } from "@/lib/crmcors";
import { parseLooseJsonObject } from "@/lib/loosejson";
import { queryTokenCandidates } from "@/lib/querytoken";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The journey whose number these go out from — one source of truth. */
const RNR_SEQUENCE = "RNR follow-up";

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

const corsP = (h: (req: Request) => Promise<Response>) => async (req: Request) => withCrmCors(await h(req), req);

/**
 * Every answer carries a sentence, because LeadSquared shows the counsellor
 * whatever we send — literally.
 *
 * Measured across three real presses on 13 October. Their lead page puts the
 * response in a RED box whatever it says, and what it puts IN the box is the
 * `message` field if there is one, or the raw JSON if there is not. So a
 * counsellor saw, in turn:
 *
 *   {"sent":false,"reason":"A WhatsApp message already went to this lead
 *    today. One a day is the limit."}
 *
 * …braces and quotes and all, for the commonest outcome there is. And before
 * that, a red box containing the single letter "A", which was this route
 * answering `message: "A"` meaning "nudge A".
 *
 * The red is theirs and we cannot change it. The words are ours. A reply that
 * reads as a sentence is the difference between "the button is broken" — twice
 * reported, both times about a send that worked — and a counsellor who knows
 * what happened.
 */
const reply = (body: Record<string, unknown>, init?: ResponseInit) =>
  NextResponse.json(
    { ...body, message: body.message ?? body.reason ?? body.error ?? "Done." },
    init,
  );

export const POST = corsP(async (req: Request) => {
  const token = req.headers.get("authorization") || "Bearer " + (req.headers.get("x-crm-token") || queryTokenCandidates(req.url)[0] || "");
  const headers = new Headers(req.headers); headers.set("authorization", token);
  const tenantId = await apiKeyTenant(new Request(req.url, { headers }));
  if (!tenantId) return reply({ error: "Invalid API key" }, { status: 401 });
  const gate = await guardFeature(tenantId, "sequences") || await guardAccount(tenantId); if (gate) return gate;
  // LeadSquared's lead action escapes this body as a string and then sends
  // it without the enclosing quotes, so req.json() rejects a payload that is
  // correct in their config box — see loosejson.ts.
  const parsed = parseLooseJsonObject(await req.text().catch(() => ""));
  if (!parsed) return reply({ error: "Invalid JSON", message: "LeadSquared sent something this endpoint could not read. Tell the portal team." }, { status: 400 });
  const body = parsed as { phone?: string; leadId?: string; counsellor?: string; name?: string; course?: string; channelId?: string; dryRun?: boolean };

  const phone = digits(body.phone);
  // LeadSquared stores Indian mobiles as ten digits as often as not, and a
  // bare ten-digit number reaches nobody — the same mistake that made every
  // tracked link dead. Add the country code rather than fail.
  const to = phone.length === 10 ? `91${phone}` : phone;
  if (to.length < 10) {
    return reply({ error: "A phone number is required. Check the lead has one." }, { status: 400 });
  }

  try {
    // Make sure there is a contact to hang the state on, and to read the
    // course from. Never overwrites a name that is already there.
    const existing = await getContactByPhoneLoose(to, tenantId);
    if (!existing) {
      await upsertContacts([{ phone: to, name: (body.name ?? "").trim() }], "leadsquared-nudge", tenantId);
    }
    const contact = await getContactByPhoneLoose(to, tenantId);
    const conv = await getConversationByPhone(to, tenantId).catch(() => null);
    const optedOut = await isOptedOut(to, tenantId).catch(() => false);

    const decision = decideNudge({
      now: new Date(),
      optedOut: optedOut || contact?.status === "optedout",
      notOnWhatsApp: !!(contact?.attributes as Record<string, string> | undefined)?.wa_unreachable_at
        || !!(contact as unknown as { waUnreachableAt?: string | null })?.waUnreachableAt,
      sentA: contact?.attributes?.[attrFor("A")] ?? null,
      sentB: contact?.attributes?.[attrFor("B")] ?? null,
      lastInboundAt: conv?.lastInboundAt ?? null,
    });

    if (!decision.send) {
      return reply({ sent: false, reason: decision.why });
    }

    // The copy, from the same definition the sequence and the approved
    // template were built from, so the three cannot disagree.
    const spec = rnrTemplates({ channelId: "" }).find(t => t.templateName === decision.template);
    if (!spec) return reply({ error: `Template ${decision.template} is not defined.` }, { status: 500 });

    // The counsellor's name comes from the click; everything else from the
    // lead. Without a counsellor the sentence reads "this is  from
    // AnalytixLabs", so it is a refusal, not a blank.
    // The course, when the CRM knows one and we do not.
    //
    // Message B names the course the lead enquired about, and our own contact
    // records almost never hold it — 122 of 2,961. LeadSquared does rather
    // better on the leads this button is pressed on: mx_Course_Interested is
    // filled on about a fifth of leads sitting on Not Reachable or RNR. The
    // connector can mail-merge it at the moment of the click for nothing, so
    // it does.
    //
    // It is injected as an ATTRIBUTE rather than passed straight through as a
    // token, so it still goes through programmeFor. That matters: the field
    // also holds "66" and "Select" in the live data, and routed this way
    // those resolve to no programme and the send is refused — rather than
    // asking somebody about their "66 enquiry". The contact wins when it has
    // a course of its own.
    const offered = (body.course ?? "").trim();
    const subject = offered && contact
      ? { ...contact, attributes: { ...(contact.attributes ?? {}), "Product Name": contact.attributes?.["Product Name"] || offered } }
      : contact;
    const tokens = {
      ...leadTokens(subject),
      counsellor_name: firstName(body.counsellor ?? "") || firstName(conv?.assignedTo ?? ""),
    };
    const missing = missingTokens(spec.params, tokens);
    if (missing.length) {
      return reply({
        sent: false,
        reason: `Cannot send yet — no value for ${missing.map(m => m.replace(/_/g, " ")).join(", ")} on this lead.`,
        missing,
      });
    }
    const params = resolveCannedParams(spec.params, tokens);

    // The number the RNR journey sends from. Taken from the sequence rather
    // than a second setting, so moving the campaign to another number moves
    // this button with it.
    const channelId = body.channelId
      || (await listSequences(tenantId).catch(() => [])).find(s => s.name === RNR_SEQUENCE)?.channelId
      || null;
    const channel = (await credsFor(channelId, tenantId)) ?? undefined;

    if (!channel) return reply({ error: "Choose a connected sending channel for this journey." }, { status: 400 });
    if (body.dryRun) {
      return reply({
        sent: false, dryRun: true, wouldSend: decision.template,
        message: `Dry run: would send ${decision.template}. ${decision.why}`,
        params, reason: decision.why, channelId,
      });
    }

    const r = await sendTemplateSingle(to, spec.templateName, "en_US", params, channel);
    if (r.error) return reply({ sent: false, error: r.error, message: `WhatsApp refused this message: ${r.error}` }, { status: 502 });

    // Only now is it true. Recording before the send would silently skip
    // tomorrow's message because of one that never left.
    await setContactAttributes(to, { [attrFor(decision.send)]: new Date().toISOString() }, tenantId);

    // Visible where a counsellor looks, and matchable by Meta's delivery
    // callback — the same treatment a drip send gets.
    const label = `template "${spec.templateName}"`;
    try {
      const c = conv ?? (await getOrCreateConversation(to, body.name, channelId, undefined, tenantId));
      if (c?.id) {
        await appendConvMessage({ tenantId, 
          conversationId: c.id, role: "assistant", body: label,
          metaId: r.id ?? null, source: "bot", channelId,
        });
        await touchOutbound(c.id, label);
      }
    } catch { /* logging must not undo a delivered message */ }
    await recordSequenceSend({ phone: to, name: contact?.name ?? null, metaMessageId: r.id ?? null }, tenantId);
    after(() => pushWaActivity({ tenantId,  phone: to, direction: "outbound", body: `RNR ${decision.send}: ${label}`, via: "agent" }));

    // What the counsellor is told, and why it reads the way it does.
    //
    // This used to answer `message: "A"`, meaning "nudge A". LeadSquared
    // renders a field called `message` as the text of its toast, so the
    // counsellor saw a red badge containing a single letter — which looks
    // exactly like an error, on a send that had in fact worked. Two of them
    // reported the button as broken on 13 October because of it.
    //
    // So `message` is now a sentence for a human and the A/B label moved to
    // `nudge`. It NAMES THE SENDING NUMBER, because the campaign sends from
    // its own line rather than the counsellor's, and a lead's reply lands in
    // a chat the counsellor does not have open.
    //
    // It also stops short of promising delivery. Meta returns a message id
    // before deciding whether to deliver, and drops marketing messages that
    // exceed a recipient's cap (131049) seconds later. The webhook retracts
    // the stamp when that happens — see rnrdelivery.ts — so "press it again"
    // is honest advice rather than a way to send the same message twice.
    // The NUMBER the lead will see it from; the channel's name only when Meta
    // would not tell us, so the sentence still says where it went.
    const from = (await displayNumberFor(channel).catch(() => null))
      ?? (channelId ? (await getChannel(channelId, tenantId))?.name ?? null : null);
    const who = firstName(contact?.name ?? body.name ?? "") || "this lead";
    return reply({
      sent: true,
      nudge: decision.send,
      message: `Message ${decision.send} sent to ${who}${from ? ` from ${from}` : ""}.`
        + " If nothing arrives, WhatsApp held it back — press again later.",
      template: spec.templateName,
      from,
      reason: decision.why,
      messageId: r.id,
    });
  } catch (err) {
    return reply({ error: errorMessage(err), message: `Something went wrong sending this: ${errorMessage(err)}` }, { status: 500 });
  }
});

// GET — the same decision without sending, for wiring up the button and for
// anybody asking "what would happen if I pressed this".
export const GET = corsP(async (req: Request) => {
  const token = req.headers.get("authorization") || "Bearer " + (req.headers.get("x-crm-token") || queryTokenCandidates(req.url)[0] || "");
  const headers = new Headers(req.headers); headers.set("authorization", token);
  const tenantId = await apiKeyTenant(new Request(req.url, { headers }));
  if (!tenantId) return reply({ error: "Invalid API key" }, { status: 401 });
  const gate = await guardFeature(tenantId, "sequences") || await guardAccount(tenantId); if (gate) return gate;
  const url = new URL(req.url);
  const phone = digits(url.searchParams.get("phone"));
  const to = phone.length === 10 ? `91${phone}` : phone;
  if (to.length < 10) return NextResponse.json({ error: "phone required" }, { status: 400 });
  try {
    const contact = await getContactByPhoneLoose(to, tenantId);
    const conv = await getConversationByPhone(to, tenantId).catch(() => null);
    const optedOut = await isOptedOut(to, tenantId).catch(() => false);
    const decision = decideNudge({
      now: new Date(),
      optedOut: optedOut || contact?.status === "optedout",
      notOnWhatsApp: !!(contact?.attributes as Record<string, string> | undefined)?.wa_unreachable_at,
      sentA: contact?.attributes?.[attrFor("A")] ?? null,
      sentB: contact?.attributes?.[attrFor("B")] ?? null,
      lastInboundAt: conv?.lastInboundAt ?? null,
    });
    return NextResponse.json({ phone: to, ...decision });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
});

// The preflight. LeadSquared's lead grid calls this endpoint from the
// counsellor's BROWSER, so without an answer here the request is blocked
// before it is ever sent and nothing appears in any log — see crmcors.ts.
export const OPTIONS = (req: Request) => crmPreflight(req);
