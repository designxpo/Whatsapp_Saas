import { currentTenantId, isPlatformOwner, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getTenantSetting } from "@/lib/store";

// The tenant the Support Desk operates on. Support-team logins already carry
// the support workspace as their session tenant — for them this is a pass-
// through. The PLATFORM OWNER's session, however, is pinned to the default
// tenant, so /support would stare at an empty workspace; for the owner the
// desk resolves the support workspace from the support_widget setting (the
// same one the in-portal widget uses to route tickets there).
export async function supportDeskTenantId(): Promise<string | null> {
  const tid = await currentTenantId();
  if (!tid) return null;
  if (await isPlatformOwner()) {
    const s = await getTenantSetting<{ tenantId?: string }>(DEFAULT_TENANT_ID, "support_widget", {});
    if (typeof s.tenantId === "string" && s.tenantId) return s.tenantId;
  }
  return tid;
}
