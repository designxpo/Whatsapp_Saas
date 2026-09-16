import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { openChallenge, relyingParty, savePasskey, PASSKEY_CHALLENGE_COOKIE } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { response?: unknown; label?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const sealed = (await cookies()).get(PASSKEY_CHALLENGE_COOKIE)?.value;
  const opened = await openChallenge(sealed, "register");
  // The challenge is bound to the account that asked for it, so a ticket issued
  // for one person cannot be completed while signed in as another.
  if (!opened || opened.email !== user.email) {
    return NextResponse.json({ error: "That setup attempt expired. Try again." }, { status: 400 });
  }

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: opened.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not verify that passkey" }, { status: 400 });
  }

  if (!verification.verified) return NextResponse.json({ error: "Could not verify that passkey" }, { status: 400 });

  const { credential, credentialBackedUp } = verification.registrationInfo;
  await savePasskey({
    email: user.email,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: (credential.transports ?? []) as string[],
    deviceName: (body.label ?? "").trim() || "Passkey",
    backedUp: credentialBackedUp,
  });

  logActivity(user, "auth.passkey.added", `added a passkey (${credentialBackedUp ? "synced" : "this device only"})`);
  return NextResponse.json({ success: true, backedUp: credentialBackedUp });
}
