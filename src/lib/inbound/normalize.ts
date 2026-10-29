// What every connector needs from a payload it did not design: the person's
// WhatsApp number, their name and email, and the rest as data an automation
// can quote. Pure, so each tool's quirks are tested without a network.

export type Json = Record<string, unknown>;

/** "a.b.0.c" path lookup; arrays index by number. */
export function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === "object") cur = (cur as Json)[part];
    else return undefined;
  }
  return cur;
}

/** The first of `paths` holding a non-empty string or number, as a trimmed string. */
export function firstText(obj: unknown, paths: string[]): string {
  for (const p of paths) {
    const v = dig(obj, p);
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  }
  return "";
}

/**
 * A phone number as WhatsApp addresses it: country code and digits, no "+".
 *
 * Tools hand over every format there is — "+91 98765 00001", "098765 00001",
 * "9876500001", "(415) 555-0100". A bare national number gets the business's
 * default country code (India unless they set another), a leading trunk 0 is
 * dropped, and anything that cannot be a phone number comes back as "" so the
 * event is logged as skipped rather than sent to the wrong person.
 */
export function normalizePhone(raw: unknown, defaultCountryCode = "91"): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const plus = s.startsWith("+") || s.startsWith("00");
  let d = s.replace(/\D/g, "");
  if (s.startsWith("00")) d = d.slice(2);
  const cc = (defaultCountryCode || "91").replace(/\D/g, "");
  if (!plus) {
    if (cc === "91") {
      if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
      if (d.length === 10) d = cc + d;
    } else if (d.startsWith("0")) {
      d = cc + d.replace(/^0+/, "");
    } else if (!d.startsWith(cc) && d.length <= 10) {
      d = cc + d;
    }
  }
  // E.164 allows at most 15 digits; fewer than 10 is not a reachable mobile.
  if (d.length < 10 || d.length > 15) return "";
  // An Indian number must be a mobile (6–9) to receive WhatsApp.
  if (d.startsWith("91") && d.length === 12 && !/^91[6-9]/.test(d)) return "";
  return d;
}

/** "ASHA VERMA" / "asha verma" → "Asha Verma"; leaves mixed case alone. */
export function tidyName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || /[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
}

// Where people keep a phone number in a form, a CRM export or a Zapier step.
// Checked in order; the first that normalises to a real number wins.
const PHONE_KEYS = [
  "phone", "mobile", "phone_number", "phoneNumber", "mobile_number", "mobileNumber",
  "whatsapp", "whatsapp_number", "contact_number", "contact", "number", "tel",
  "customer.phone", "contact.phone", "lead.phone", "data.phone", "fields.phone",
];
const NAME_KEYS = ["name", "full_name", "fullName", "customer_name", "customer.name", "contact.name", "lead.name", "data.name"];
const EMAIL_KEYS = ["email", "email_address", "emailAddress", "customer.email", "contact.email", "lead.email", "data.email"];

/**
 * A generic payload's person: an explicit path wins, else the usual keys,
 * looked up case-insensitively at the top level.
 */
export function findPerson(body: Json, opts: { phonePath?: string; namePath?: string; emailPath?: string; defaultCountryCode?: string } = {}): { phone: string; name: string; email: string } {
  const lower: Json = {};
  for (const [k, v] of Object.entries(body)) lower[k.toLowerCase()] = v;
  const look = (explicit: string | undefined, keys: string[]) => {
    if (explicit?.trim()) return firstText(body, [explicit.trim()]);
    return firstText(body, keys) || firstText(lower, keys.map(k => k.toLowerCase()));
  };
  let phone = "";
  for (const k of opts.phonePath?.trim() ? [opts.phonePath.trim()] : PHONE_KEYS) {
    phone = normalizePhone(firstText(body, [k]) || firstText(lower, [k.toLowerCase()]), opts.defaultCountryCode);
    if (phone) break;
  }
  const first = firstText(body, ["first_name", "firstName"]);
  const last = firstText(body, ["last_name", "lastName"]);
  const name = look(opts.namePath, NAME_KEYS) || [first, last].filter(Boolean).join(" ");
  return { phone, name: tidyName(name), email: look(opts.emailPath, EMAIL_KEYS) };
}

/** Body text as JSON, or form-encoded fields (WooCommerce's ping, many form tools). */
export function parseBody(raw: string, contentType: string | null): Json | null {
  const t = raw.trim();
  if (!t) return {};
  if ((contentType ?? "").includes("application/x-www-form-urlencoded") || (!t.startsWith("{") && !t.startsWith("[") && t.includes("="))) {
    const out: Json = {};
    for (const [k, v] of new URLSearchParams(t)) out[k] = v;
    return out;
  }
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : { items: v };
  } catch {
    return null;
  }
}

/** "1234.50" + "INR" → "₹1,234.50"; other currencies keep their code. Indian digit grouping for INR. */
export function formatMoney(amount: unknown, currency = "INR"): string {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? ""));
  if (!Number.isFinite(n)) return "";
  const cur = (currency || "INR").toUpperCase();
  const fixed = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (cur !== "INR") return `${cur} ${Number(fixed).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const [whole, frac] = fixed.split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `₹${grouped}${frac ? `.${frac}` : ""}`;
}

/** "Shopify customer, VIP" → both; nothing given → the connector's own tag. */
export const tagsFrom = (csv: string | undefined, fallback: string): string[] =>
  csv?.trim() ? csv.split(",").map(t => t.trim()).filter(Boolean) : [fallback];

/** An event name as part of an event key: "Order Paid!" → "order_paid". */
export const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "received";

/** A moment as a customer reads it, in their own time zone: "Thu, 30 Oct, 4:30 pm". */
export function formatWhen(iso: unknown, timeZone = "Asia/Kolkata"): { when: string; date: string; time: string } {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return { when: "", date: "", time: "" };
  const tz = (() => { try { new Intl.DateTimeFormat("en-IN", { timeZone }); return timeZone; } catch { return "Asia/Kolkata"; } })();
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return { when: `${date}, ${time}`, date, time };
}
