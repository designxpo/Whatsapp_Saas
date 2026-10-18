// "Where did this lead come from?" — answered in one readable phrase.
//
// The five UTM parameters are faithful and almost unreadable in a CRM list
// view: a counsellor scanning leads does not want utm_source=fb,
// utm_medium=paid-social, they want "Facebook (paid)". So the raw values are
// stored as they arrived AND condensed into one field.
//
// ── Why a derived label rather than just the raw fields ────────────────────
//
// Because the raw fields disagree with each other constantly. The same
// Facebook campaign arrives as fb, facebook, FB, facebook.com and
// m.facebook.com depending on who built the URL; paid arrives as cpc, ppc,
// paid, paid_social and paidsocial. Reporting that groups on utm_source is
// reporting on how carefully each marketer typed. This normalises once, in
// one place, so a report is about traffic rather than about spelling.
//
// ── Why "unknown" is a real answer ─────────────────────────────────────────
//
// A lead with no UTMs is not organic. It is a lead we failed to tag, and
// those two have opposite meanings for a budget decision: organic means the
// channel works for free, untagged means the measurement is broken. Calling
// an untagged lead "Organic" would quietly inflate the one number nobody
// wants inflated, so it is never inferred — it has to be stated by the URL.

/** What the ad platforms put in the URL, as it arrived. */
export interface UtmSet {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
}

const norm = (v: unknown): string =>
  String(v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");

/** The platform, under one name per platform. */
const PLATFORM: [RegExp, string][] = [
  [/^(google|googleads|google-ads|adwords|gdn|youtube|yt)\b/, "Google"],
  [/^(fb|facebook|meta|ig|instagram)\b/, "Meta"],
  [/^(bing|microsoft|msn)\b/, "Microsoft"],
  [/^(linkedin|li)\b/, "LinkedIn"],
  [/^(x|twitter)\b/, "X"],
  [/^(whatsapp|wa)\b/, "WhatsApp"],
  [/^(email|newsletter|mailer|sendgrid|mailchimp)\b/, "Email"],
  [/^(quora|reddit|taboola|outbrain|affiliate|partner)\b/, "Partner"],
];

/** Paid or not. Only what the URL says — never guessed from the platform. */
const PAID = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|display|cpm|cpv|retargeting|remarketing)\b/;
const ORGANIC = /^(organic|social|referral|email|newsletter|none|seo)\b/;

export interface Origin {
  /** "Google (paid)", "Meta (organic)", "Email", "Unknown" */
  label: string;
  /** The platform alone, for grouping. */
  platform: string;
  /** "paid" | "organic" | "unknown" — never inferred from the platform. */
  kind: "paid" | "organic" | "unknown";
}

/**
 * Condense a UTM set into one phrase.
 *
 * A click id is evidence of paid traffic on its own: a gclid or an fbclid is
 * only ever appended by an ad click, so a URL carrying one is paid even if
 * whoever built it forgot the medium. That is the single inference made here,
 * and it is made from a fact rather than from a convention.
 */
export function deriveOrigin(u: UtmSet): Origin {
  const src = norm(u.source);
  const med = norm(u.medium);

  let platform = "";
  for (const [re, name] of PLATFORM) {
    if (re.test(src)) { platform = name; break; }
  }
  // No usable source, but a click id names the platform by itself.
  if (!platform && u.gclid) platform = "Google";
  if (!platform && u.fbclid) platform = "Meta";
  // A source we have no rule for is still worth naming. Title-casing is right
  // for a word ("coursera" → "Coursera") and wrong for a host, which
  // title-case turns into "Chatgpt.Com" — a real value seen in production.
  if (!platform && src) platform = src.includes(".") ? src : src.replace(/\b\w/g, c => c.toUpperCase());

  let kind: Origin["kind"] = "unknown";
  if (PAID.test(med)) kind = "paid";
  else if (ORGANIC.test(med)) kind = "organic";
  else if (u.gclid || u.fbclid) kind = "paid";

  if (!platform) return { label: "Unknown", platform: "", kind };
  if (kind === "unknown") return { label: platform, platform, kind };
  return { label: `${platform} (${kind})`, platform, kind };
}

/**
 * The attributes to stamp on a contact. Empty values are left out entirely
 * rather than written blank — a blank reads as "we looked and there was
 * nothing", which is a different claim from "we never knew".
 */
export function utmAttributes(u: UtmSet): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => { const s = String(v ?? "").trim(); if (s) out[k] = s.slice(0, 256); };
  put("utm_source", u.source);
  put("utm_medium", u.medium);
  put("utm_campaign", u.campaign);
  put("utm_term", u.term);
  put("utm_content", u.content);
  put("fbclid", u.fbclid);
  // Only worth stamping when something was actually known.
  if (Object.keys(out).length || u.gclid) {
    const o = deriveOrigin(u);
    if (o.label !== "Unknown") out.lead_origin = o.label;
  }
  return out;
}

/** True when there is anything at all worth carrying into WhatsApp. */
export function hasAttribution(u: UtmSet): boolean {
  return !!(u.source || u.medium || u.campaign || u.term || u.content || u.gclid || u.fbclid);
}
