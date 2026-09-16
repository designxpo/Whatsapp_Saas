import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { relyingParty, sealChallenge, PASSKEY_CHALLENGE_COOKIE, CHALLENGE_COOKIE_OPTIONS } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

// Public by necessity — this is the start of signing in. It leaks nothing: no
// username is taken, no allowCredentials list is returned (the credentials are
// discoverable, so the browser offers whichever ones it holds for this domain),
// and a random challenge tells an anonymous caller nothing about who has an
// account here.
export async function POST(req: Request) {
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });

  const res = NextResponse.json(options);
  res.cookies.set(PASSKEY_CHALLENGE_COOKIE, await sealChallenge(options.challenge, "login"), CHALLENGE_COOKIE_OPTIONS);
  return res;
}
