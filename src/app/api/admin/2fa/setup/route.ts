import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { currentUser } from "@/lib/auth";
import { beginEnrolment } from "@/lib/twofactor";

export const dynamic = "force-dynamic";

// Enrolment happens from a SIGNED-IN session here, not mid-login: an
// authenticator is an optional upgrade on this product, chosen from the account
// screen, rather than something everyone is marched through on first sign-in.
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const { secret, uri } = await beginEnrolment(user.email);
    // Rendered server-side so the secret is never handed to a client library
    // and the page works with no outbound network access from the browser.
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
    return NextResponse.json({ secret, uri, qr });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start setup" }, { status: 400 });
  }
}
