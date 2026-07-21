import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createTenantFromSignup } from "@/lib/tenants";
import { createSession, verifyPendingToken, SESSION_COOKIE, PENDING_SIGNUP_COOKIE, PENDING_SIGNUP_PURPOSE } from "@/lib/auth";
import { sendEmailOtp, verifyEmailOtp } from "@/lib/emailotp";
import { trustDevice, newDeviceToken, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE } from "@/lib/devices";
import { errorMessage } from "@/lib/errors";

interface PendingSignup {
  company: string; ownerName: string; ownerEmail: string; password: string;
  ownerPhone?: string; industry?: string; teamSize?: string; useCase?: string; expectedVolume?: string; termsVersion?: string;
}

// POST — completes the signup-OTP challenge started by /api/signup. Only on a
// correct code does the tenant + admin account actually get created.
//   { code: string }     verify the code and create the account
//   { resend: true }     re-send a code for the same pending signup
export async function POST(req: Request) {
  let body: { code?: string; resend?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const jar = await cookies();
  const pendingToken = jar.get(PENDING_SIGNUP_COOKIE)?.value;
  const pending = await verifyPendingToken<PendingSignup>(pendingToken, PENDING_SIGNUP_PURPOSE);
  if (!pending) return NextResponse.json({ error: "Your signup session expired — please start again." }, { status: 401 });

  if (body.resend) {
    const sent = await sendEmailOtp(pending.ownerEmail, "signup");
    if (!sent.ok) return NextResponse.json({ error: sent.error || "Could not send verification code" }, { status: 502 });
    return NextResponse.json({ sent: true });
  }

  const code = (body.code ?? "").trim();
  const verified = await verifyEmailOtp(pending.ownerEmail, "signup", code);
  if (!verified.ok) return NextResponse.json({ error: verified.error || "Incorrect code" }, { status: 400 });

  try {
    const { tenantId, email } = await createTenantFromSignup(pending);

    // The signer just proved they own this inbox — trust this device so they
    // aren't immediately hit with a login-OTP challenge right after signing up.
    const deviceToken = newDeviceToken();
    await trustDevice(email, deviceToken);

    const token = await createSession({ email, name: pending.ownerName, role: "admin", tenantId });
    const res = NextResponse.json({ success: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    res.cookies.set(DEVICE_COOKIE, deviceToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE });
    res.cookies.delete(PENDING_SIGNUP_COOKIE);
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
