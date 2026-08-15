// Thin client for the portal's own /api/admin/* routes — the admin-tab twin of
// extension/src/api.js's apiFetch, with the same { ok, status, data, error }
// shape and the same "name the cause instead of the status code" rules.
//
// Why: a bare `fetch(...).then(r => r.json())` in a tab renders an expired
// session, a CSRF block, a plan gate and a stale-deploy HTML 404 as either a
// silent no-op or an empty list. Every one of those is actionable by the tenant.
//
// Client components only (relies on the browser attaching wa_admin_session).
// JSON in, JSON out — don't use it for FormData uploads or file downloads.

export type AdminResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export async function adminFetch<T = Record<string, unknown>>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<AdminResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server — check your connection and try again." };
  }
  let parsed: unknown = null;
  // A route that hasn't deployed yet answers with Next's HTML 404, not JSON — so
  // there's no data.error to fall back on. Same for a 500 error page.
  try { parsed = await res.json(); } catch { /* non-JSON (HTML 404/500 page) */ }
  const d = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const apiError = typeof d.error === "string" && d.error ? d.error : null;
  if (res.status === 401) return { ok: false, status: 401, error: "Your session has expired — reload the page and sign in again." };
  if (res.status === 403) return { ok: false, status: 403, error: apiError ?? "Blocked for security — reload the page and try again." };
  if (res.status === 404 && !apiError) return { ok: false, status: 404, error: "This isn't on the server yet — your workspace needs the latest update. Try again in a minute." };
  if (res.status === 429) return { ok: false, status: 429, error: apiError ?? "Too many requests — wait a moment and try again." };
  if (res.status >= 500 && !apiError) return { ok: false, status: res.status, error: "The server hit an error. Try again shortly." };
  if (!res.ok) return { ok: false, status: res.status, error: apiError ?? `Request failed (${res.status})` };
  return { ok: true, status: res.status, data: d as T };
}
