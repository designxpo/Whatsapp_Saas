import { NextResponse } from "next/server";
import { currentUser, isPlatformOwnerEmail } from "@/lib/auth";
import { getTenant, type Tenant } from "@/lib/tenants";
import { getActiveBanner, type Announcement } from "@/lib/announcements";
import { getEntitlements } from "@/lib/entitlements";
import { hasActiveChannel } from "@/lib/channels";
import { ONBOARDING_STALE_MS } from "@/lib/onboardingnudge";

export const dynamic = "force-dynamic";

// GET — who am I (drives role-based UI, the owner portal link, the first-login
// walkthrough, the global announcement banner, and the tenant's feature
// entitlements that gate which tabs/actions the portal shows).
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isPlatformOwner = isPlatformOwnerEmail(user.email);
  let needsWalkthrough = false;
  let tenant: Tenant | null = null;
  try { tenant = await getTenant(user.tenantId); needsWalkthrough = !!tenant && !tenant.onboarded; } catch { /* table not migrated yet */ }

  let banner: Announcement | null = await getActiveBanner();
  // Tenant-scoped fallback: nobody set a platform-wide banner, but this tenant
  // signed up a day+ ago and still hasn't connected a single channel — nudge
  // them back to Setup & status instead of leaving them stuck silently. Never
  // for the platform owner's own session (their default workspace can validly
  // run channel-less, on env credentials — see channels.ts's single-number
  // fallback — and isn't a customer who needs onboarding at all).
  if (!isPlatformOwner && !banner && tenant && Date.now() - new Date(tenant.createdAt).getTime() > ONBOARDING_STALE_MS) {
    const hasChannel = await hasActiveChannel(user.tenantId).catch(() => true);
    if (!hasChannel) {
      banner = {
        id: "setup-nudge", title: "Finish setting up Talko AI",
        body: "Connect a channel to start getting AI replies — head to Setup & status to pick up where you left off.",
        level: "warning", pinned: true, active: true, createdAt: new Date().toISOString(),
      };
    }
  }

  // Entitlements are resolved server-side and never throw (fail-open).
  const entitlements = await getEntitlements(user.tenantId).catch(() => null);
  return NextResponse.json({ user: { ...user, isPlatformOwner }, needsWalkthrough, banner, entitlements });
}
