import { NextResponse } from "next/server";
import { loginThrottle, recordLoginFailure } from "@/lib/loginthrottle";
import { sendResetCode } from "@/lib/passwordreset";

export const dynamic = "force-dynamic";

// Ask for a reset code. Public, and deliberately uninformative: unknown
// address, platform owner, deactivated member, rate-limited, or a code
// genuinely sent all return the same body. Anything that distinguished them
// would turn this into a way to find out who has an account here.
export async function POST(req: Request) {
  let body: { email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = (body.email ?? "").trim().toLowerCase();

  // Keyed on the address, not the client IP, which is taken from a header the
  // caller sets and could be varied to walk a list.
  const key = `forgot:${email}`;
  const gate = await loginThrottle(key);
  if (gate.allowed && email) {
    await recordLoginFailure(key);
    await sendResetCode(email).catch(() => undefined);
  }

  return NextResponse.json({
    sent: true,
    message: "If there's an account with that email, a reset code is on its way to it.",
  });
}
