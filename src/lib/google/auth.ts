// The portal's own Google identity: one service account.
//
// A business connects a Google Sheet or Calendar by SHARING it with this
// account's email address, the way they would share it with a colleague. No
// "Sign in with Google": that needs Google to review and verify the portal as
// an OAuth app first (sensitive scopes), and the business would hand over
// access to every sheet and calendar it has. Sharing gives the portal exactly
// the one sheet or calendar the business chose, and they can take it back from
// Google's own Share dialog at any time.
//
// (GOOGLE_OAUTH_CLIENT_ID / _SECRET are the YouTube sign-in, a different thing.)
//
// The key is GOOGLE_SERVICE_ACCOUNT_JSON: the JSON file Google Cloud gives for
// a service account key, pasted as-is or base64-encoded. It never leaves the
// server; only the account's email address is shown to a business.
//
// Access tokens come from Google's OAuth token endpoint with a signed JWT
// (RFC 7523, "jwt-bearer"), and are cached until a minute before they expire.

import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// spreadsheets: read the rows a business wants messaged, append leads, write a
// row's status. calendar: free/busy (which calendar.events does NOT authorise),
// the calendar's name, and adding the booked event. A service account has no
// consent screen, so these are not "sensitive scope" requests to any user —
// and the account reaches only what has been shared with it.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
];

export interface ServiceAccount { email: string; privateKey: string }

/** The service account from the environment, or null when it is missing or unreadable. */
export function serviceAccount(): ServiceAccount | null {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) return null;
  const text = raw.startsWith("{") ? raw : (() => {
    try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return ""; }
  })();
  try {
    const j = JSON.parse(text) as { client_email?: unknown; private_key?: unknown };
    const email = typeof j.client_email === "string" ? j.client_email.trim() : "";
    // Pasted through a dashboard, the key's newlines often arrive as the two
    // characters "\n".
    const privateKey = typeof j.private_key === "string" ? j.private_key.replace(/\\n/g, "\n") : "";
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email) || !privateKey.includes("PRIVATE KEY")) return null;
    return { email, privateKey };
  } catch {
    return null;
  }
}

/** The address a business shares its sheet or calendar with; null when the portal has no Google account set up. */
export function googleRobotEmail(): string | null {
  return serviceAccount()?.email ?? null;
}

export const NOT_SET_UP = "The portal's Google access is not set up yet (GOOGLE_SERVICE_ACCOUNT_JSON). Ask the portal's administrator.";

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** The signed assertion exchanged for an access token. Exported for tests. */
export function signedAssertion(sa: ServiceAccount, nowSec: number, scopes = GOOGLE_SCOPES): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.email, scope: scopes.join(" "), aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}

let cached: { token: string; expiresAt: number; email: string } | null = null;

/** Forget the cached token. For tests, and after Google rejects one. */
export function resetGoogleToken(): void { cached = null; }

export class GoogleAuthError extends Error {}

/** An access token for the portal's service account. Throws GoogleAuthError when it cannot get one. */
export async function googleAccessToken(): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new GoogleAuthError(NOT_SET_UP);
  if (cached && cached.email === sa.email && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  let assertion: string;
  try { assertion = signedAssertion(sa, Math.floor(Date.now() / 1000)); }
  catch { throw new GoogleAuthError("The portal's Google key could not be read. Ask the portal's administrator to paste the service account key again."); }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    redirect: "error", signal: AbortSignal.timeout(10_000),
  }).catch(() => { throw new GoogleAuthError("Could not reach Google to sign in. Try again in a minute."); });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    // invalid_grant: the key was deleted or rotated in Google Cloud.
    throw new GoogleAuthError(body.error === "invalid_grant"
      ? "Google no longer accepts the portal's service account key. Ask the portal's administrator to create a new key."
      : `Google refused the portal's sign-in (HTTP ${res.status}).`);
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, email: sa.email };
  return cached.token;
}
