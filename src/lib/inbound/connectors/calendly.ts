// Calendly: booking confirmations, reschedules and cancellations on WhatsApp.
//
// Calendly webhooks exist only through its API (and only on paid plans), so
// connecting is "paste a personal access token" and the portal creates the
// subscription itself, with a signing key it chose. Facts relied on
// (developer.calendly.com, checked 29 Oct 2026):
//   • GET /users/me → resource.uri and resource.current_organization.
//   • POST /webhook_subscriptions {url, events, organization, scope, user?,
//     signing_key}. Organization scope needs an owner/admin; others get user.
//     A Free plan answers 403 "Please upgrade your Calendly account".
//   • Calendly-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">;
//     reject when t is more than 180 s old.
//   • A reschedule is invitee.canceled with rescheduled:true, then
//     invitee.created with old_invitee set.
//   • The phone is text_reminder_number only when the event type asks for an
//     SMS reminder number; otherwise it has to be found among the answers.

import { randomBytes } from "crypto";
import { normalizePhone, firstText, formatWhen, tagsFrom, tidyName, type Json } from "../normalize";
import { hmac, safeEqual } from "../signature";
import type { Provider } from "../providers";

// Every call to the tool times out rather than holding the request open.
const extFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

const API = "https://api.calendly.com";
const MAX_AGE_SEC = 180;

/** The phone a booking carries, wherever the event type asked for it. */
export function calendlyPhone(payload: Json, cc?: string): string {
  const direct = normalizePhone(firstText(payload, ["text_reminder_number"]), cc);
  if (direct) return direct;
  const qa = Array.isArray(payload.questions_and_answers) ? payload.questions_and_answers as Json[] : [];
  for (const a of qa) {
    if (/phone|mobile|whatsapp|contact number|number/i.test(String(a.question ?? ""))) {
      const p = normalizePhone(a.answer, cc);
      if (p) return p;
    }
  }
  return "";
}

async function calendly(token: string, path: string, init: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  // URIs come back from Calendly and are stored; the token must still never be
  // sent anywhere but Calendly's own API.
  if (!url.startsWith(`${API}/`)) throw new Error("Refusing to send the Calendly token outside api.calendly.com");
  const r = await extFetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({})) as Json;
  return { status: r.status, ok: r.ok, body };
}

const messageOf = (b: Json) => firstText(b, ["message", "title", "details.0.message"]) || "unknown error";

export const calendlyProvider: Provider = {
  verify({ headers, raw, secrets }) {
    const key = secrets.signingKey ?? "";
    if (!key) return "Calendly is not fully connected yet (no signing key). Connect it again.";
    const header = headers.get("calendly-webhook-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map(kv => kv.trim().split("=") as [string, string]));
    if (!parts.t || !parts.v1) return "Calendly did not sign this request.";
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > MAX_AGE_SEC) return "Calendly's signature is too old to trust (more than 3 minutes).";
    return safeEqual(parts.v1, hmac(key, `${parts.t}.${raw}`, "hex")) ? null : "Calendly's signature did not match.";
  },

  parse({ body, config }) {
    const event = String(body.event ?? "");
    const p = (body.payload ?? {}) as Json;
    if (event !== "invitee.created" && event !== "invitee.canceled") return [];
    // The cancel half of a reschedule: the created half says it better.
    if (event === "invitee.canceled" && p.rescheduled === true) return [];
    const eventKey = event === "invitee.canceled" ? "calendly.booking_canceled"
      : p.old_invitee ? "calendly.booking_rescheduled" : "calendly.booking_created";

    const tz = firstText(p, ["timezone"]) || "Asia/Kolkata";
    const when = formatWhen(firstText(p, ["scheduled_event.start_time"]), tz);
    return [{
      eventKey,
      externalId: `${event}:${firstText(p, ["uri"])}`,
      phone: calendlyPhone(p, config.defaultCountryCode),
      name: tidyName(firstText(p, ["name"])),
      email: firstText(p, ["email"]),
      data: {
        meeting: firstText(p, ["scheduled_event.name"]),
        when: when.when, date: when.date, time: when.time, timezone: tz,
        start_time: firstText(p, ["scheduled_event.start_time"]),
        join_url: firstText(p, ["scheduled_event.location.join_url"]),
        location: firstText(p, ["scheduled_event.location.location"]),
        reschedule_url: firstText(p, ["reschedule_url"]),
        cancel_url: firstText(p, ["cancel_url"]),
        cancel_reason: firstText(p, ["cancellation.reason"]),
      },
      tags: tagsFrom(config.tags, "Calendly booking"),
      attributes: { last_booking: `${firstText(p, ["scheduled_event.name"])} — ${when.when}`.slice(0, 120) },
      ...(eventKey === "calendly.booking_canceled" ? { cancels: ["calendly.booking_created", "calendly.booking_rescheduled"] } : {}),
    }];
  },

  async connect({ webhookUrl, secrets }) {
    const token = secrets.apiToken ?? "";
    if (!token) return { ok: false, detail: "Paste a Calendly personal access token." };
    try {
      const me = await calendly(token, "/users/me");
      if (me.status === 401) return { ok: false, detail: "Calendly rejected the token. Create a new one in Calendly → Integrations → API & Webhooks." };
      if (!me.ok) return { ok: false, detail: `Calendly answered HTTP ${me.status}: ${messageOf(me.body)}` };
      const userUri = firstText(me.body, ["resource.uri"]);
      const orgUri = firstText(me.body, ["resource.current_organization"]);
      const signingKey = secrets.signingKey || randomBytes(24).toString("base64url");
      const events = ["invitee.created", "invitee.canceled"];

      const create = (scope: "organization" | "user") => calendly(token, "/webhook_subscriptions", {
        method: "POST",
        body: JSON.stringify({ url: webhookUrl, events, organization: orgUri, scope, signing_key: signingKey, ...(scope === "user" ? { user: userUri } : {}) }),
      });

      let scope: "organization" | "user" = "organization";
      let made = await create(scope);
      if (made.status === 403 && /upgrade/i.test(messageOf(made.body))) {
        return { ok: false, detail: "Calendly only allows webhooks on paid plans (Standard or above). Upgrade the Calendly account, then connect again." };
      }
      if (made.status === 403) { scope = "user"; made = await create(scope); }
      if (made.status === 409) {
        // A subscription for this URL already exists (connected before): replace
        // it, because its signing key is not the one we now hold.
        const list = await calendly(token, `/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&scope=${scope}${scope === "user" ? `&user=${encodeURIComponent(userUri)}` : ""}`);
        const old = (Array.isArray(list.body.collection) ? list.body.collection as Json[] : []).find(s => s.callback_url === webhookUrl);
        if (old?.uri) await calendly(token, String(old.uri), { method: "DELETE" });
        made = await create(scope);
      }
      if (!made.ok) return { ok: false, detail: `Calendly would not create the webhook (HTTP ${made.status}): ${messageOf(made.body)}` };
      return {
        ok: true,
        detail: scope === "organization" ? "Connected. Bookings across your Calendly organisation will come in." : "Connected. Your own Calendly bookings will come in (an organisation admin can connect the whole team).",
        config: { subscriptionUri: firstText(made.body, ["resource.uri"]), scope },
        secrets: { signingKey },
      };
    } catch (err) {
      return { ok: false, detail: `Could not reach Calendly: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async disconnect(config, secrets) {
    if (config.subscriptionUri && secrets.apiToken) {
      await calendly(secrets.apiToken, config.subscriptionUri, { method: "DELETE" }).catch(() => undefined);
    }
  },
};
