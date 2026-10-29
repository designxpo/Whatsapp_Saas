// IndiaMART: every buyer enquiry greeted on WhatsApp in seconds, with the
// product they asked about.
//
// Uses IndiaMART's Lead Manager Push API: the seller pastes the portal's URL
// under Lead Manager → Import/Export → Push API → "Other" (confirmed by OTP).
// Facts relied on (help.indiamart.com, checked 29 Oct 2026):
//   • JSON POST, the lead under RESPONSE; a 200 counts as delivered, failures
//     are retried and push is switched off after 48 h of failures.
//   • No signature, auth header or IP list is documented — so, like a Zapier
//     catch hook, the unguessable token in the URL is the credential.
//   • UNIQUE_QUERY_ID identifies an enquiry; SENDER_NAME defaults to
//     "IndiaMART Buyer" when the buyer gave none; the mobile's format is not
//     documented, so it is normalised like any other.

import { normalizePhone, firstText, tagsFrom, tidyName, type Json } from "../normalize";
import type { Provider } from "../providers";

const QUERY_TYPES: Record<string, string> = { W: "Direct enquiry", B: "Buy lead", P: "Phone call", BIZ: "Catalogue enquiry", WA: "WhatsApp enquiry" };

export const indiamartProvider: Provider = {
  verify: () => null,

  parse({ body, config }) {
    const leads = Array.isArray(body.RESPONSE) ? body.RESPONSE as Json[]
      : body.RESPONSE && typeof body.RESPONSE === "object" ? [body.RESPONSE as Json]
      : body.UNIQUE_QUERY_ID ? [body] : [];
    return leads.map(l => {
      const name = firstText(l, ["SENDER_NAME"]);
      return {
        eventKey: "indiamart.lead_received",
        externalId: firstText(l, ["UNIQUE_QUERY_ID"]) || null,
        phone: normalizePhone(firstText(l, ["SENDER_MOBILE", "SENDER_MOBILE_ALT"]), config.defaultCountryCode),
        name: /^indiamart buyer$/i.test(name) ? "" : tidyName(name),
        email: firstText(l, ["SENDER_EMAIL", "SENDER_EMAIL_ALT"]),
        data: {
          product: firstText(l, ["QUERY_PRODUCT_NAME", "SUBJECT"]),
          message: firstText(l, ["QUERY_MESSAGE"]).slice(0, 500),
          category: firstText(l, ["QUERY_MCAT_NAME"]),
          company: firstText(l, ["SENDER_COMPANY"]),
          city: firstText(l, ["SENDER_CITY"]),
          enquiry_type: QUERY_TYPES[firstText(l, ["QUERY_TYPE"])] ?? firstText(l, ["QUERY_TYPE"]),
          received_at: firstText(l, ["QUERY_TIME"]),
        },
        tags: tagsFrom(config.tags, "IndiaMART lead"),
        attributes: {
          indiamart_product: firstText(l, ["QUERY_PRODUCT_NAME", "SUBJECT"]).slice(0, 120),
          ...(firstText(l, ["SENDER_COMPANY"]) ? { indiamart_company: firstText(l, ["SENDER_COMPANY"]).slice(0, 120) } : {}),
        },
      };
    });
  },
};
