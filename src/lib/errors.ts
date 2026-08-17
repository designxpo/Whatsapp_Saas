// Extracts a human-readable message from any thrown value. Supabase (and other
// SDK) errors are often plain objects with a .message — String(err) on those
// yields the useless "[object Object]".
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const k of ["message", "error_description", "error", "details", "hint"]) {
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
    }
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return String(err);
}

// A channel-save failure appended "— make sure migrations X and Y are applied"
// to EVERY error unconditionally — a network blip, an RLS rejection, or a bad
// phoneId all got told to "apply a migration," which is not only wrong but is
// an instruction a tenant cannot act on (they don't have database access).
// Only worth saying when the error is actually the missing-column signature
// Postgres/PostgREST produce for it; Postgres 42703 and PostgREST's PGRST204
// are the two real shapes this takes.
const MISSING_COLUMN_RE = /column .* does not exist|PGRST204|\b42703\b/i;

export function describeChannelSaveError(err: unknown, migrationHint: string): string {
  const msg = errorMessage(err);
  if (MISSING_COLUMN_RE.test(msg)) return `${msg} — apply ${migrationHint} to this database, then try again.`;
  return `Couldn't save this channel: ${msg}. Try again, and contact support if it keeps happening.`;
}

// Structured error log line (single JSON object per error) so production logs
// can be filtered/aggregated by `tag`, instead of the bare `console.error`
// scattered across the codebase. Use for best-effort operations whose failure
// should be observable but must not throw.
export function logError(tag: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    console.error(JSON.stringify({ level: "error", tag, msg: errorMessage(err), ...(extra ?? {}) }));
  } catch {
    console.error(`[${tag}]`, err);
  }
}
