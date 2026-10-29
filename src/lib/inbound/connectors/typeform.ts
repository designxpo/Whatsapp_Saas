// Typeform: greet everyone who submits a form, on WhatsApp, seconds later.
//
// Facts relied on (typeform.com/developers/webhooks, checked 29 Oct 2026):
//   • Typeform-Signature: "sha256=" + base64 HMAC-SHA256 of the raw body,
//     keyed with the secret set on the form's webhook (the portal generates it).
//   • Body {event_type: "form_response", form_response: {form_id, token,
//     definition: {title, fields}, answers[], hidden}}. Each answer carries its
//     value under its type: phone_number, email, text, choice.label…
//   • A 404 or 410 reply DISABLES the webhook immediately — so this never
//     answers those for a delivery it understood.

import { normalizePhone, firstText, tagsFrom, tidyName, slug, type Json } from "../normalize";
import { hmac, safeEqual } from "../signature";
import type { Provider } from "../providers";

/** An answer's value as text, whatever its type. */
function answerText(a: Json): string {
  switch (a.type) {
    case "choice": return firstText(a, ["choice.label", "choice.other"]);
    case "choices": return ((a.choices as Json | undefined)?.labels as string[] | undefined ?? []).join(", ");
    case "boolean": return a.boolean ? "yes" : "no";
    default: return firstText(a, [String(a.type ?? "text"), "text"]);
  }
}

export const typeformProvider: Provider = {
  verify({ headers, raw, secrets }) {
    const secret = secrets.webhookSecret ?? "";
    if (!secret) return "No Typeform webhook secret is saved.";
    const sent = headers.get("typeform-signature") ?? "";
    if (!sent) return "Typeform did not sign this request. Add the secret shown in the portal to the form's webhook.";
    return safeEqual(sent, `sha256=${hmac(secret, raw, "base64")}`) ? null : "Typeform's signature did not match the secret shown in the portal.";
  },

  parse({ body, config }) {
    if (body.event_type !== "form_response") return [];
    const r = (body.form_response ?? {}) as Json;
    const fields = Array.isArray((r.definition as Json | undefined)?.fields) ? (r.definition as Json).fields as Json[] : [];
    const titleOf = new Map(fields.map(f => [String(f.id), String(f.title ?? "")]));
    const answers = Array.isArray(r.answers) ? r.answers as Json[] : [];

    let phone = "", email = "", name = "";
    const data: Json = { form: firstText(r, ["definition.title"]), form_id: firstText(r, ["form_id"]), submitted_at: firstText(r, ["submitted_at"]) };
    for (const a of answers) {
      const field = (a.field ?? {}) as Json;
      const title = titleOf.get(String(field.id)) ?? "";
      const value = answerText(a);
      if (a.type === "phone_number" && !phone) phone = normalizePhone(value, config.defaultCountryCode);
      else if (a.type === "email" && !email) email = value;
      else if (!name && a.type === "text" && /name/i.test(title)) name = value;
      // Quotable in a message by the field's ref (set in Typeform) or its question.
      const key = slug(String(field.ref ?? "") || title);
      if (key && value) data[key] = value;
    }
    for (const [k, v] of Object.entries((r.hidden ?? {}) as Json)) if (typeof v === "string") data[k] = v;

    return [{
      eventKey: "typeform.form_submitted",
      externalId: firstText(r, ["token"]) || null,
      phone, email, name: tidyName(name),
      data,
      tags: tagsFrom(config.tags, `Typeform: ${String(data.form || "form")}`.slice(0, 40)),
      attributes: { last_form: String(data.form ?? "") },
    }];
  },
};
