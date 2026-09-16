import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { resetTwoFactor, twoFactorStatus } from "@/lib/twofactor";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(await twoFactorStatus(user.email));
}

// Turning it off is allowed — it is an optional upgrade, and a product that
// traps customers in a factor they can no longer use generates support tickets,
// not security. It needs a live session, so whoever does it already has access;
// it is logged, and the emailed new-device challenge takes over again.
export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  await resetTwoFactor(user.email);
  logActivity(user, "auth.2fa.disabled", "turned off their authenticator app");
  return NextResponse.json({ success: true });
}
