// Admin layout — injects the Talko AI support web-chat widget on every /admin
// page (best effort: any failure renders children unchanged, never throws).
//
// White-label: on a partner's address it also wraps the portal in the
// partner's brand, keeps each address to its own users, and leaves Talko's
// support widget out. While white-label is off (or on Talko's own address)
// the brand is Talko's and nothing here changes what renders.
// The widget's branding/position come from the channel's widgetConfig served by
// the loader itself — nothing is hardcoded here beyond the site key lookup.

import Script from "next/script";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import "driver.js/dist/driver.css";
import "./onboarding.css";
import { DEFAULT_TENANT_ID, currentTenantId, currentUser } from "@/lib/auth";
import { getTenantSetting } from "@/lib/store";
import { getTenant } from "@/lib/tenants";
import { signWidgetIdentity } from "@/lib/webchat";
import { requestBrand, sessionHostCheck } from "@/lib/brand-server";
import { partnerMetadata } from "@/lib/brand-metadata";
import { BrandProvider } from "@/components/BrandContext";

// {siteKey, tenantId} stored on the DEFAULT tenant under "support_widget";
// tenantId is the support workspace so its own agents don't get the widget.
interface SupportWidgetSetting { siteKey?: string; tenantId?: string }

async function supportWidget(): Promise<{ src: string; identity: string | null } | null> {
  try {
    const s = await getTenantSetting<SupportWidgetSetting>(DEFAULT_TENANT_ID, "support_widget", {});
    const siteKey = typeof s.siteKey === "string" ? s.siteKey.trim() : "";
    if (!siteKey) return null;
    // Only for signed-in customers — and never for the support workspace's own
    // agents (they'd be chatting with themselves).
    const tid = await currentTenantId();
    if (!tid || tid === s.tenantId) return null;
    const src = `/api/widget/${encodeURIComponent(siteKey)}/loader.js`;

    // Signed identity: the desk shows "Workspace · user@email" instead of
    // "Website visitor". The HMAC keeps external visitors from forging it.
    let identity: string | null = null;
    try {
      const [tenant, user] = await Promise.all([getTenant(tid), currentUser()]);
      const signed = user && signWidgetIdentity({ tenantId: tid, tenant: tenant?.name || "Unnamed workspace", email: user.email }, siteKey);
      // </script> can never appear in the inline payload (breaks out of the tag).
      if (signed) identity = JSON.stringify(signed).replace(/</g, "\\u003c");
    } catch { /* identity is optional — the widget works without it */ }
    return { src, identity };
  } catch {
    return null; // widget is strictly best-effort
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await requestBrand();
  return brand.partnerId ? partnerMetadata(brand) : {};
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { brand, unknown } = await requestBrand();
  if (unknown) notFound();
  const where = await sessionHostCheck(await currentUser());
  if (where === "notfound") notFound();
  if (where) redirect(where);
  if (brand.partnerId) return <BrandProvider brand={brand}>{children}</BrandProvider>;

  const w = await supportWidget();
  return (
    <>
      {children}
      {w?.identity && (
        <Script id="twc-identity" strategy="lazyOnload">{`window.__twcIdentity=${w.identity};`}</Script>
      )}
      {w && <Script src={w.src} strategy="lazyOnload" />}
    </>
  );
}
