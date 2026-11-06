// Edge-safe (no Node imports): used by middleware.ts and auth.ts.
//
// Every token this app signs shares ADMIN_JWT_SECRET: workspace sessions,
// affiliate and partner sessions, and the half-finished login / signup
// tokens. A good signature therefore proves only that WE minted it, not that
// it is a workspace session — an affiliate cookie pasted into
// wa_admin_session used to pass this gate. A workspace session is the one
// kind with no `purpose` claim and an email as its subject (auth.ts
// createSession). verifySession() still does the real, live check.
export function isWorkspaceSessionClaims(payload: Record<string, unknown>): boolean {
  if (payload.purpose !== undefined) return false;
  return typeof payload.sub === "string" && payload.sub.includes("@") && typeof payload.t === "string" && payload.t.length > 0;
}
