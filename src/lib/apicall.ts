import { DEFAULT_TENANT_ID } from "./tenant";
// Calling our own API from the browser, so a failure is a failure.
//
// ── What this is for ────────────────────────────────────────────────────────
//
// The portal has 286 fetch calls and 71 of them check the response. The rest
// use one of two shapes, and both turn a server error into something that
// looks like success:
//
//   await fetch(url, { method: "POST", … });  setSavedAt(Date.now());
//       → "Saved ✓" after an HTTP 500. The operator believes automation is
//         paused when it is still running.
//
//   fetch(url).then(r => r.json()).then(setState);
//       → a 500 body is still valid JSON, so `{ error: "…" }` is stored where
//         a status object was expected. The next property read throws and the
//         screen goes blank.
//
// Neither is a missing feature; both are the same missing line. A helper is
// better than adding that line in 215 places because the line keeps being
// forgotten — the point is that the default path cannot succeed quietly.
//
// ── Why it throws rather than returning a result object ─────────────────────
//
// A result object can be ignored exactly as easily as a Response can. A throw
// cannot: the `setSavedAt` after it does not run unless the call worked. That
// is the whole behaviour being bought.
//
// Callers that genuinely want to carry on regardless still can, with a catch
// — but then the decision is written down at the call site instead of being
// the accident of never having checked.

/** A non-2xx answer from our own API, carrying what the server said. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** True for 401/403 — the caller may want to offer sign-in rather than retry. */
    readonly auth: boolean = status === 401 || status === 403,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The sentence to show a person.
 *
 * Server messages are preferred because they are specific ("migration 0020 is
 * not applied" beats "something went wrong"), but a raw network rejection has
 * no useful message of its own, so it gets one.
 */
export function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Your session has expired. Sign in again.";
    if (e.status === 403) return e.message || "You do not have permission to do that.";
    return e.message || `The server returned an error (${e.status}).`;
  }
  if (e instanceof Error && /fetch|network|load failed/i.test(e.message)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return e instanceof Error && e.message ? e.message : "Something went wrong.";
}

async function parse<T>(res: Response, tenantId = DEFAULT_TENANT_ID): Promise<T> {
  const text = await res.text().catch(() => "");

  if (!res.ok) {
    // Our routes answer errors as { error: "…" }. Anything else (an HTML error
    // page from the platform, an empty body) must not be shown raw to a
    // person, so it falls back to the status.
    let message = "";
    try { message = String((JSON.parse(text) as { error?: unknown })?.error ?? ""); } catch { /* not JSON */ }
    throw new ApiError(res.status, message);
  }

  // A 2xx with an unparseable body is still a broken call. Treating it as
  // `undefined` is how a caller ends up reading a property of nothing.
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, "The server sent a response we could not read.");
  }
}

export async function getJson<T>(url: string, init?: RequestInit, tenantId = DEFAULT_TENANT_ID): Promise<T> {
  return parse<T>(await fetch(url, init), tenantId);
}

export async function postJson<T>(url: string, body?: unknown, init?: RequestInit, tenantId = DEFAULT_TENANT_ID): Promise<T> {
  return parse<T>(await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...init,
  }), tenantId);
}

export async function putJson<T>(url: string, body?: unknown, init?: RequestInit, tenantId = DEFAULT_TENANT_ID): Promise<T> {
  return postJson<T>(url, body, { ...init, method: "PUT" }, tenantId);
}

export async function delJson<T>(url: string, init?: RequestInit, tenantId = DEFAULT_TENANT_ID): Promise<T> {
  return parse<T>(await fetch(url, { method: "DELETE", ...init }), tenantId);
}

/**
 * Guard a sequence of requests so only the newest one is allowed to write
 * state.
 *
 * A search box fires a request per keystroke and the answers come back in
 * whatever order the network decides. Without this, typing "Alice" then "Bob"
 * can leave Alice's rows on screen under the word Bob — and anything the
 * operator then clicks acts on the wrong person.
 *
 * AbortController alone does not fix it: aborting is a request to stop, and a
 * response already in flight can still land. The generation check is what
 * actually decides whose answer counts, so both are used — abort to save the
 * work, the counter to be correct.
 *
 *   const gen = useRef(newGeneration());
 *   const mine = gen.current.next();
 *   const d = await getJson(url, { signal: gen.current.signal });
 *   if (!mine.current()) return;     // a newer search started; drop this
 */
export function newGeneration() {
  let n = 0;
  let controller: AbortController | null = null;
  return {
    /** Start a new attempt, cancelling the previous one. */
    next() {
      controller?.abort();
      controller = new AbortController();
      const mine = ++n;
      const signal = controller.signal;
      return { signal, current: () => mine === n };
    },
    get signal() { return controller?.signal; },
    /** True when an error is just our own cancellation, not a real failure. */
    aborted(e: unknown) {
      return e instanceof DOMException && e.name === "AbortError";
    },
  };
}
