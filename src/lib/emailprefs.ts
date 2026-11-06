// Opt-out for recurring lifecycle email (the weekly recap, the daily digest).
//
// A marketing email needs a working one-click opt-out — not only because
// CAN-SPAM and GDPR require one, but because Gmail and Yahoo's bulk-sender
// rules make List-Unsubscribe support a deliverability condition. A footer link
// that doesn't unsubscribe anyone is worse than no footer link: the recipient's
// next move is the spam button, which costs the whole sending domain.
//
// The link carries an HMAC of (tenant, kind[, recipient]) rather than a raw
// tenant id, so a recipient can't unsubscribe another workspace — or another
// person — by editing the URL, and no database lookup is needed to validate it.
//
// A link with a recipient unsubscribes that one address (the daily digest goes
// to every admin, and one admin opting out mustn't stop it for the rest, nor be
// undone when an admin switches the digest back on). Links without one — the
// older format, still honoured — opt the whole workspace out of that stream.

import crypto from "crypto";
import { getTenantSetting, setTenantSetting } from "./store";
import { SITE_URL } from "./siteurl";

/** Email streams a recipient can opt out of, independently of each other. */
export type EmailKind = "weekly_recap" | "daily_digest" | "product_news" | "review_alerts" | "work_alerts";
const KINDS: readonly EmailKind[] = ["weekly_recap", "daily_digest", "product_news", "review_alerts", "work_alerts"];
const isKind = (k: string): k is EmailKind => (KINDS as readonly string[]).includes(k);

const SETTING_PREFIX = "email_optout:";

function secret(): string | null {
  const s = process.env.ADMIN_JWT_SECRET;
  return s && s.length >= 32 ? s : null;
}

function sign(tenantId: string, kind: EmailKind, s: string, recipient?: string): string {
  // JSON array input, matching the convention in webchat.ts — no delimiter
  // ambiguity between the fields.
  const parts = recipient ? ["email-optout", tenantId, kind, recipient] : ["email-optout", tenantId, kind];
  return crypto.createHmac("sha256", s).update(JSON.stringify(parts)).digest("base64url");
}

const norm = (email: string) => email.trim().toLowerCase();
const b64 = (v: string) => Buffer.from(v, "utf8").toString("base64url");

/**
 * Absolute unsubscribe URL for this tenant and stream.
 *
 * Falls back to a mailto: when ADMIN_JWT_SECRET isn't configured. That keeps
 * every send compliant in a misconfigured environment instead of either
 * emitting a link that can't be verified or dropping the opt-out entirely.
 */
export function unsubscribeUrl(tenantId: string, kind: EmailKind, recipient?: string): string {
  const s = secret();
  if (!s) return `mailto:info@thetalko.in?subject=Unsubscribe%20from%20Talko%20AI%20emails`;
  // The tenant id (and recipient) are base64url-encoded, NOT percent-encoded:
  // encodeURIComponent leaves "." untouched, so an id or address containing a
  // dot would add a part to the token and fail to parse. base64url's alphabet
  // has no ".", which makes the delimiter unambiguous.
  const who = recipient ? norm(recipient) : "";
  const token = who
    ? `${b64(tenantId)}.${kind}.${b64(who)}.${sign(tenantId, kind, s, who)}`
    : `${b64(tenantId)}.${kind}.${sign(tenantId, kind, s)}`;
  return `${SITE_URL}/api/email/unsubscribe?t=${token}`;
}

/** Verify a token from the unsubscribe link. Returns null if it doesn't check out. */
export function verifyUnsubscribeToken(token: string): { tenantId: string; kind: EmailKind; recipient?: string } | null {
  const s = secret();
  if (!s) return null;
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [rawTenant, kind] = parts;
  const sig = parts[parts.length - 1];
  if (!isKind(kind)) return null;
  // base64url decoding is lenient rather than throwing on malformed input, which
  // is fine — a wrong decode simply produces an id whose HMAC won't match below.
  const tenantId = Buffer.from(rawTenant, "base64url").toString("utf8");
  if (!tenantId) return null;
  const recipient = parts.length === 4 ? Buffer.from(parts[2], "base64url").toString("utf8") : undefined;
  if (parts.length === 4 && !recipient) return null;

  const expected = sign(tenantId, kind, s, recipient);
  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return recipient ? { tenantId, kind, recipient } : { tenantId, kind };
}

const listKey = (kind: EmailKind) => `${SETTING_PREFIX}${kind}:recipients`;

/** Opted out: the whole workspace, or (when given) this one address. */
export async function isUnsubscribed(tenantId: string, kind: EmailKind, recipient?: string): Promise<boolean> {
  if ((await getTenantSetting<boolean>(tenantId, `${SETTING_PREFIX}${kind}`, false)) === true) return true;
  return recipient ? (await unsubscribedRecipients(tenantId, kind)).has(norm(recipient)) : false;
}

/** The addresses that opted out of this stream one by one. */
export async function unsubscribedRecipients(tenantId: string, kind: EmailKind): Promise<Set<string>> {
  const list = await getTenantSetting<string[] | null>(tenantId, listKey(kind), null);
  return new Set(Array.isArray(list) ? list.map(norm) : []);
}

/** With a recipient, opts just that address in or out; without, the whole workspace. */
export async function setUnsubscribed(tenantId: string, kind: EmailKind, value: boolean, recipient?: string): Promise<void> {
  if (!recipient) { await setTenantSetting(tenantId, `${SETTING_PREFIX}${kind}`, value); return; }
  const set = await unsubscribedRecipients(tenantId, kind);
  if (value) set.add(norm(recipient)); else set.delete(norm(recipient));
  await setTenantSetting(tenantId, listKey(kind), [...set]);
}
