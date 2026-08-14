// Page scan — turn a whole page's visible text into a reviewable contact list.
//
// COMPLIANCE: nothing here runs on its own. The popup injects a collector only
// when the tenant clicks "Scan page", on the tab they're looking at, and the
// results are only ever PROPOSED — a human ticks the rows before anything is
// saved. This module is pure: no DOM, no network, no chrome APIs.
//
// The collector hands us loose candidates ({ text, tel, mail }); everything
// below decides which of them is really a person.

import { normalizePhone } from "./wa.js";

const PHONE_RE = /\+?\d[\d\s().-]{7,16}\d/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Never a person's name — the words pages put next to a number.
const GENERIC = /\b(call|calling|phone|telephone|tel|mobile|whatsapp|sms|text us|email|e-?mail|mail|fax|contact|contacts|enquir\w*|inquir\w*|support|helpline|help ?desk|customer care|toll ?free|sales|reception|address|office|hours|open now|closed|directions|map|copy|copied|share|click|tap|book|apply|register|subscribe|read more|learn more|view|show|hide|menu|search|login|log ?in|sign ?in|sign ?up|home|about us|privacy|terms|cookies)\b/i;
// Mailbox names that belong to a company, not a person.
const ROLE_MAILBOX = /^(info|contact|contacts|hello|hi|help|support|sales|admin|office|team|enquir\w*|inquir\w*|careers?|jobs|hr|billing|accounts?|invoice|noreply|no-reply|donotreply|webmaster|postmaster|marketing|press|media|service|customercare|orders?)$/i;

export const SCAN_LIMIT = 60;          // rows we show; a page can hold hundreds
export const IMPORT_LIMIT = 25;        // rows one import may add, to stay kind to the API

// A number written the local way gets the workspace's country code — otherwise
// "98765 43210" would be saved as an unreachable 10-digit contact.
//
// `minLocal` is the precision dial. Loose text only gets the benefit of the
// doubt at 10 digits (India's mobile length); an 8- or 9-digit local number is
// accepted only from a `tel:` link, where the site itself declared it dialable.
/** @param {string} digits @param {string} [cc] @param {{ minLocal?: number }} [opts] */
export function withCountryCode(digits, cc = "91", { minLocal = 10 } = {}) {
  const d = String(digits ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const code = String(cc ?? "").replace(/\D/g, "");
  if (!d) return "";
  return code && d.length >= minLocal && d.length <= 10 ? `${code}${d}` : d;
}

// Straight runs like 1234567890 or 0000000000 are IDs, prices and placeholders.
/** @param {string} digits */
function isSequential(digits) {
  let up = true, down = true;
  for (let i = 1; i < digits.length; i++) {
    const step = Number(digits[i]) - Number(digits[i - 1]);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

/** @param {string} digits */
export function looksLikePhone(digits) {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 15) return false;   // 10 = a local mobile, 15 = E.164 max
  if (/^(\d)\1+$/.test(d)) return false;
  return !isSequential(d);
}

// A page fragment → a person's name, or "" when it clearly isn't one.
/** @param {string} piece @param {string} [email] */
export function cleanName(piece, email = "") {
  let p = String(piece ?? "").replace(/\s+/g, " ").trim();
  if (!p || p.length > 60) return "";
  if (email && p.toLowerCase() === email.toLowerCase()) return "";
  if (p.includes("@") || /https?:\/\/|www\./i.test(p)) return "";
  p = p.replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}.]+$/u, "").trim();
  if (!p || /\d/.test(p)) return "";                  // names don't carry digits; addresses do
  if (GENERIC.test(p)) return "";
  const words = p.split(" ").filter(Boolean);
  if (words.length > 5) return "";
  const letters = p.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3 || letters.length / p.length < 0.55) return "";
  return p;
}

// priya.sharma@acme.com → "Priya Sharma". Skipped for role mailboxes, which
// belong to a company: info@, sales@, careers@.
/** @param {string} email */
export function nameFromEmail(email) {
  const local = String(email ?? "").split("@")[0] ?? "";
  if (!local || ROLE_MAILBOX.test(local)) return "";
  const words = local.split(/[._\-+]+/).filter(w => /^\p{L}{2,}$/u.test(w)).slice(0, 3);
  if (!words.length) return "";
  const name = words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return cleanName(name);
}

// Pick the name out of the text around a number. A name sits just BEFORE its
// number far more often than after, so we search backwards from the number first.
/** @param {string} text @param {{ phone?: string, email?: string }} [found] */
export function nameFromContext(text, { phone = "", email = "" } = {}) {
  const pieces = String(text ?? "")
    .split(/[\n\r·•|]+|,\s|\s[-–—]\s|\s{3,}/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!pieces.length) return "";

  const tail = String(phone ?? "").replace(/\D/g, "").slice(-8);
  const holdsNumber = (p) => (tail ? p.replace(/\D/g, "").includes(tail) : PHONE_RE.test(p));
  const at = pieces.findIndex(holdsNumber);

  const before = at > 0 ? pieces.slice(0, at).reverse() : [];
  const after = at >= 0 ? pieces.slice(at + 1) : pieces;
  for (const p of [...before, ...after]) {
    const n = cleanName(p, email);
    if (n) return n;
  }
  return "";
}

/** @typedef {{ text?: string, tel?: string, mail?: string }} Candidate */
/** @typedef {{ phone: string, name: string, email: string, context: string }} ScannedContact */

// Candidates → de-duplicated, human-reviewable contacts, in page order.
/** @param {Candidate[]} candidates @param {{ cc?: string, limit?: number }} [opts] */
export function contactsFromCandidates(candidates, { cc = "91", limit = SCAN_LIMIT } = {}) {
  /** @type {Map<string, ScannedContact>} */
  const byPhone = new Map();

  for (const c of Array.isArray(candidates) ? candidates : []) {
    const text = String(c?.text ?? "");
    const tel = String(c?.tel ?? "").trim();
    const rawPhone = tel || text.match(PHONE_RE)?.[0] || "";
    const phone = withCountryCode(normalizePhone(rawPhone).digits, cc, { minLocal: tel ? 8 : 10 });
    if (!looksLikePhone(phone)) continue;             // no reachable number → not a lead

    const email = (String(c?.mail ?? "").trim() || text.match(EMAIL_RE)?.[0] || "").toLowerCase();
    const name = nameFromContext(text, { phone: rawPhone, email }) || nameFromEmail(email);
    const context = text.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)[0] ?? "";

    const seen = byPhone.get(phone);
    if (!seen) { byPhone.set(phone, { phone, name, email, context }); continue; }
    // The same number often appears in a header, a card and a footer. Keep the
    // first sighting's position but let later ones fill in what was missing.
    if (!seen.name && name) seen.name = name;
    if (!seen.email && email) seen.email = email;
    if (!seen.context && context) seen.context = context;
  }

  const all = [...byPhone.values()];
  return { contacts: all.slice(0, Math.max(0, limit)), total: all.length };
}
