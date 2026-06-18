// The single source of truth for the default tenant id.
//
// Every pre-multitenant caller resolves to this tenant, so existing call sites
// keep working while routes are retrofitted to pass a real tenantId. Defined in
// its own dependency-free module so every lib can import it without risking an
// import cycle (auth.ts re-exports it for the many `@/lib/auth` consumers).
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
