// Opt-out for recurring lifecycle email (currently: the weekly recap).
//
// A marketing email needs a working one-click opt-out — not only because
// CAN-SPAM and GDPR require one, but because Gmail and Yahoo's bulk-sender
// rules make List-Unsubscribe support a deliverability condition. A footer link
// that doesn't unsubscribe anyone is worse than no footer link: the recipient's
// next move is the spam button, which costs the whole sending domain.
//
// The link carries an HMAC of (tenant, kind) rather than a raw tenant id, so a
// recipient can't unsubscribe another workspace by editing the URL, and no
// database lookup is needed to validate it.

import crypto from "crypto";
import { getTenantSetting, setTenantSetting } from "./store";
import { SITE_URL } from "./siteurl";

/** Email streams a recipient can opt out of, independently of each other. */
export type EmailKind = "weekly_recap";

const SETTING_PREFIX = "email_optout:";

function secret(): string | null {
  const s = process.env.ADMIN_JWT_SECRET;
  return s && s.length >= 32 ? s : null;
}

function sign(tenantId: string, kind: EmailKind, s: string): string {
  // JSON array input, matching the convention in webchat.ts — no delimiter
  // ambiguity between the two fields.
  return crypto.createHmac("sha256", s).update(JSON.stringify(["email-optout", tenantId, kind])).digest("base64url");
}

/**
 * Absolute unsubscribe URL for this tenant and stream.
 *
 * Falls back to a mailto: when ADMIN_JWT_SECRET isn't configured. That keeps
 * every send compliant in a misconfigured environment instead of either
 * emitting a link that can't be verified or dropping the opt-out entirely.
 */
export function unsubscribeUrl(tenantId: string, kind: EmailKind): string {
  const s = secret();
  if (!s) return `mailto:info@thetalko.in?subject=Unsubscribe%20from%20Talko%20AI%20emails`;
  // The tenant id is base64url-encoded, NOT percent-encoded: encodeURIComponent
  // leaves "." untouched, so a tenant id containing a dot would produce a
  // four-part token and fail to parse. base64url's alphabet has no ".", which
  // makes the delimiter unambiguous whatever the id format is.
  const token = `${Buffer.from(tenantId, "utf8").toString("base64url")}.${kind}.${sign(tenantId, kind, s)}`;
  return `${SITE_URL}/api/email/unsubscribe?t=${token}`;
}

/** Verify a token from the unsubscribe link. Returns null if it doesn't check out. */
export function verifyUnsubscribeToken(token: string): { tenantId: string; kind: EmailKind } | null {
  const s = secret();
  if (!s) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawTenant, kind, sig] = parts;
  if (kind !== "weekly_recap") return null;
  // base64url decoding is lenient rather than throwing on malformed input, which
  // is fine — a wrong decode simply produces an id whose HMAC won't match below.
  const tenantId = Buffer.from(rawTenant, "base64url").toString("utf8");
  if (!tenantId) return null;

  const expected = sign(tenantId, kind, s);
  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { tenantId, kind };
}

export async function isUnsubscribed(tenantId: string, kind: EmailKind): Promise<boolean> {
  return (await getTenantSetting<boolean>(tenantId, `${SETTING_PREFIX}${kind}`, false)) === true;
}

export async function setUnsubscribed(tenantId: string, kind: EmailKind, value: boolean): Promise<void> {
  await setTenantSetting(tenantId, `${SETTING_PREFIX}${kind}`, value);
}
