import { NextResponse } from "next/server";
import { currentUser, isPlatformOwnerEmail } from "@/lib/auth";
import { getTenant } from "@/lib/tenants";
import { getActiveBanner } from "@/lib/announcements";

export const dynamic = "force-dynamic";

// GET — who am I (drives role-based UI, the owner portal link, the first-login
// walkthrough, and the global announcement banner).
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isPlatformOwner = isPlatformOwnerEmail(user.email);
  let needsWalkthrough = false;
  try { const t = await getTenant(user.tenantId); needsWalkthrough = !!t && !t.onboarded; } catch { /* table not migrated yet */ }
  const banner = await getActiveBanner();
  return NextResponse.json({ user: { ...user, isPlatformOwner }, needsWalkthrough, banner });
}
