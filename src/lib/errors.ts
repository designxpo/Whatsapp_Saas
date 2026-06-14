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
