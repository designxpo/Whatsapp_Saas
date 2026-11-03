// One call to a Google API as the portal's service account.
//
// Errors come back as GoogleApiError, which carries the HTTP status (so a
// caller can say the thing a business can act on — "share it with …" for a
// 403, "check the link" for a 404 — instead of Google's wording) and whether
// trying again moments later could work (a 429, a 5xx, a dropped connection).

import { googleAccessToken, resetGoogleToken, GoogleAuthError } from "./auth";

export class GoogleApiError extends Error {
  readonly retry: boolean;
  constructor(message: string, readonly status: number) {
    super(message);
    this.retry = status === 429 || status >= 500;
  }
}

type Json = Record<string, unknown>;

/** Google's own explanation, short — never a token or a key. */
function reason(body: Json): string {
  const err = body.error as Json | string | undefined;
  const msg = typeof err === "string" ? err : typeof err?.message === "string" ? err.message : "";
  return msg.replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function googleCall(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<Json> {
  let token: string;
  try { token = await googleAccessToken(); }
  catch (err) { throw new GoogleApiError(err instanceof GoogleAuthError ? err.message : "Could not sign in to Google.", 401); }

  const send = (t: string) => fetch(url, {
    method,
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });

  let res: Response;
  try {
    res = await send(token);
    if (res.status === 401) {
      // A token revoked early (the key was rotated): one fresh sign-in.
      resetGoogleToken();
      res = await send(await googleAccessToken());
    }
  } catch (err) {
    if (err instanceof GoogleAuthError) throw new GoogleApiError(err.message, 401);
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    // A timeout is not retried: the first attempt may have landed.
    throw new GoogleApiError(timedOut ? "Google did not answer in time." : "Could not reach Google.", timedOut ? 408 : 503);
  }

  if (res.status === 204) return {};
  const json = ((await res.json().catch(() => ({}))) ?? {}) as Json;
  if (!res.ok) {
    const why = reason(json);
    throw new GoogleApiError(`Google answered HTTP ${res.status}${why ? `: ${why}` : ""}`, res.status);
  }
  return json;
}
