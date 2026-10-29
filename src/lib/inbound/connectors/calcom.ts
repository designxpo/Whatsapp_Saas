// Cal.com: booking confirmations, reschedules and cancellations on WhatsApp.
//
// The business adds a webhook in Cal.com (Settings → Developer → Webhooks)
// with the portal's URL and the secret the portal generated. Facts relied on
// (cal.com/docs webhooks + the signing code in calcom/cal.com, checked 29 Oct
// 2026):
//   • X-Cal-Signature-256 = hex HMAC-SHA256 of the raw body with the webhook
//     secret; the literal "no-secret-provided" when none was set.
//   • Body {triggerEvent, createdAt, payload}; BOOKING_CREATED / _RESCHEDULED
//     / _CANCELLED are the ones a customer hears about.
//   • The attendee's phone is in payload.responses.attendeePhoneNumber.value
//     when the booking form asks for it (payload version 2021-10-20).

import { normalizePhone, firstText, formatWhen, tagsFrom, tidyName, type Json } from "../normalize";
import { hmac, safeEqual } from "../signature";
import type { Provider } from "../providers";

const TRIGGERS: Record<string, string> = {
  BOOKING_CREATED: "calcom.booking_created",
  BOOKING_RESCHEDULED: "calcom.booking_rescheduled",
  BOOKING_CANCELLED: "calcom.booking_cancelled",
};

/** The attendee's name: a plain string, or {firstName, lastName} on newer forms. */
function attendeeName(p: Json): string {
  const v = (p.responses as Json | undefined)?.name as Json | undefined;
  const raw = v?.value;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return [firstText(raw, ["firstName"]), firstText(raw, ["lastName"])].filter(Boolean).join(" ");
  return firstText(p, ["attendees.0.name"]);
}

export const calcomProvider: Provider = {
  verify({ headers, raw, secrets }) {
    const secret = secrets.webhookSecret ?? "";
    if (!secret) return "No Cal.com webhook secret is saved.";
    const sent = headers.get("x-cal-signature-256") ?? "";
    if (!sent || sent === "no-secret-provided") return "Cal.com sent this without a secret. Paste the secret shown in the portal into the webhook in Cal.com.";
    return safeEqual(sent, hmac(secret, raw, "hex")) ? null : "Cal.com's signature did not match the secret shown in the portal.";
  },

  parse({ body, config }) {
    const trigger = String(body.triggerEvent ?? "");
    const eventKey = TRIGGERS[trigger];
    if (!eventKey) return [];
    const p = (body.payload ?? {}) as Json;
    const tz = firstText(p, ["attendees.0.timeZone", "organizer.timeZone"]) || "Asia/Kolkata";
    const start = firstText(p, ["startTime"]);
    const when = formatWhen(start, tz);
    const location = firstText(p, ["location"]);
    return [{
      eventKey,
      externalId: `${trigger}:${firstText(p, ["uid", "bookingId"])}:${start}`,
      phone: normalizePhone(
        firstText(p, ["responses.attendeePhoneNumber.value", "attendees.0.phoneNumber", "responses.phone.value", "smsReminderNumber"]),
        config.defaultCountryCode,
      ),
      name: tidyName(attendeeName(p)),
      email: firstText(p, ["attendees.0.email", "responses.email.value"]),
      data: {
        meeting: firstText(p, ["title", "eventTitle"]),
        when: when.when, date: when.date, time: when.time, timezone: tz,
        start_time: start,
        meeting_url: firstText(p, ["metadata.videoCallUrl"]) || (/^https?:\/\//.test(location) ? location : ""),
        location,
        host: firstText(p, ["organizer.name"]),
        cancel_reason: firstText(p, ["cancellationReason"]),
      },
      tags: tagsFrom(config.tags, "Cal.com booking"),
      attributes: { last_booking: `${firstText(p, ["title"])} — ${when.when}`.slice(0, 120) },
      ...(eventKey === "calcom.booking_cancelled" ? { cancels: ["calcom.booking_created", "calcom.booking_rescheduled"] } : {}),
    }];
  },
};
