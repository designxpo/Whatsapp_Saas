// Admin layout — injects the Talko AI support web-chat widget on every /admin
// page (best effort: any failure renders children unchanged, never throws).
// The widget's branding/position come from the channel's widgetConfig served by
// the loader itself — nothing is hardcoded here beyond the site key lookup.

import Script from "next/script";
import { DEFAULT_TENANT_ID, currentTenantId } from "@/lib/auth";
import { getTenantSetting } from "@/lib/store";

// {siteKey, tenantId} stored on the DEFAULT tenant under "support_widget";
// tenantId is the support workspace so its own agents don't get the widget.
interface SupportWidgetSetting { siteKey?: string; tenantId?: string }

async function supportWidgetSrc(): Promise<string | null> {
  try {
    const s = await getTenantSetting<SupportWidgetSetting>(DEFAULT_TENANT_ID, "support_widget", {});
    const siteKey = typeof s.siteKey === "string" ? s.siteKey.trim() : "";
    if (!siteKey) return null;
    // Only for signed-in customers — and never for the support workspace's own
    // agents (they'd be chatting with themselves).
    const tid = await currentTenantId();
    if (!tid || tid === s.tenantId) return null;
    return `/api/widget/${encodeURIComponent(siteKey)}/loader.js`;
  } catch {
    return null; // widget is strictly best-effort
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const src = await supportWidgetSrc();
  return (
    <>
      {children}
      {src && <Script src={src} strategy="lazyOnload" />}
    </>
  );
}
