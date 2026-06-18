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
