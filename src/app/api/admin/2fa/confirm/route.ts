import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { loginThrottle, recordLoginFailure, clearLoginFailures } from "@/lib/loginthrottle";
import { confirmEnrolment } from "@/lib/twofactor";

export const dynamic = "force-dynamic";

// The first correct code proves the authenticator works before anything starts
// depending on it, and returns the backup codes — the only time they are ever
// readable.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let body: { code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const key = `totp:${user.email.toLowerCase()}`;
  const gate = await loginThrottle(key);
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many incorrect codes. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 900) } });
  }

  const { ok, backupCodes } = await confirmEnrolment(user.email, body.code ?? "");
  if (!ok) {
    await recordLoginFailure(key);
    return NextResponse.json({ error: "That code is not right. Check the app and try the next one." }, { status: 400 });
  }
  await clearLoginFailures(key);

  logActivity(user, "auth.2fa.enrolled", "turned on an authenticator app");
  return NextResponse.json({ success: true, backupCodes });
}
