import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { currentUser } from "@/lib/auth";
import { listPasskeys, relyingParty, sealChallenge, PASSKEY_CHALLENGE_COOKIE, CHALLENGE_COOKIE_OPTIONS } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

// Adding a passkey needs a FULL session — password AND second factor already
// done. This is the load-bearing check of the whole feature: a passkey alone
// signs you in afterwards, so if a half-authenticated ticket could register
// one, anybody holding a stolen password could mint themselves a credential
// and never be asked for the second factor again.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { rpID, rpName } = relyingParty(req);
  const { passkeys } = await listPasskeys(user.email);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    // Stable per account so re-registering replaces the entry on the
    // authenticator instead of stacking up duplicates, and derived rather than
    // the raw address so the handle stored on the device is not a mailing list.
    userID: new Uint8Array(createHash("sha256").update(user.email.toLowerCase()).digest()),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: "none",
    // Stops the same authenticator being enrolled twice, which otherwise looks
    // like success and then quietly shadows the older entry.
    excludeCredentials: passkeys.map(p => ({ id: p.credentialId, transports: p.transports as never })),
    authenticatorSelection: {
      // Discoverable, so signing in is one tap with no username typed first.
      residentKey: "required",
      // Biometric or PIN every time. This is what makes a single passkey a
      // genuine two-factor event — something you have plus something you are —
      // rather than just a key sitting on an unlocked laptop.
      userVerification: "required",
    },
  });

  const res = NextResponse.json(options);
  res.cookies.set(PASSKEY_CHALLENGE_COOKIE, await sealChallenge(options.challenge, "register", user.email), CHALLENGE_COOKIE_OPTIONS);
  return res;
}
