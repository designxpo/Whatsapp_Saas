import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { createSession, liveSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { loginThrottle, recordLoginFailure, clearLoginFailures } from "@/lib/loginthrottle";
import { findByCredentialId, openChallenge, relyingParty, touchPasskey, PASSKEY_CHALLENGE_COOKIE } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

// A verified passkey signs you straight in: no password, no emailed code.
//
// That is not a way around the second factor, it is a stronger one. The browser
// binds the credential to this exact origin, so the fake login page that would
// happily collect a password and a live emailed code cannot get the
// authenticator to answer at all. userVerification is required, so a biometric
// or device PIN was checked before it signed — possession plus inherence, in
// one step.
export async function POST(req: Request) {
  let body: { response?: { id?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const credentialId = body.response?.id;
  if (!credentialId) return NextResponse.json({ error: "No passkey in that response" }, { status: 400 });

  const opened = await openChallenge((await cookies()).get(PASSKEY_CHALLENGE_COOKIE)?.value, "login");
  if (!opened) return NextResponse.json({ error: "That sign-in attempt expired. Try again." }, { status: 400 });

  const stored = await findByCredentialId(credentialId);
  // Deliberately the same wording as a failed verification below: an anonymous
  // caller must not be able to tell "no such passkey here" from "that did not
  // verify", or this becomes a way to test whether a credential is registered.
  if (!stored) return NextResponse.json({ error: "That passkey was not accepted." }, { status: 401 });

  const key = `passkey:${stored.email.toLowerCase()}`;
  const gate = await loginThrottle(key);
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 900) } });
  }

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: opened.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: stored.transports as never,
      },
    });
  } catch {
    await recordLoginFailure(key);
    return NextResponse.json({ error: "That passkey was not accepted." }, { status: 401 });
  }
  if (!verification.verified) {
    await recordLoginFailure(key);
    return NextResponse.json({ error: "That passkey was not accepted." }, { status: 401 });
  }
  await clearLoginFailures(key);

  // Role, tenant and active state are re-read rather than carried on the
  // credential: a passkey registered months ago says nothing about whether the
  // account still exists or what it may now do.
  const user = await liveSessionUser(stored.email);
  if (!user) return NextResponse.json({ error: "This account is no longer active." }, { status: 403 });

  // Synced passkeys legitimately never advance their counter, so this is
  // recorded rather than policed — a stalled counter is normal, not a clone.
  await touchPasskey(stored.credentialId, verification.authenticationInfo.newCounter);

  logActivity(user, "auth.login", "signed in with a passkey");
  const token = await createSession(user);
  const res = NextResponse.json({ success: true, user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  res.cookies.set(PASSKEY_CHALLENGE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
