import { NextResponse } from "next/server";
import { logActivity } from "@/lib/team";
import { MIN_PASSWORD_LENGTH, resetPassword } from "@/lib/passwordreset";

export const dynamic = "force-dynamic";

// Spend the code, set the new password — and stop there.
//
// No session is issued. Anyone with an authenticator or a passkey still meets
// it at sign-in, so control of a mailbox is not by itself control of the
// account. Signing somebody in here would make email the weakest link and the
// second factor decorative.
export async function POST(req: Request) {
  let body: { email?: string; code?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = (body.email ?? "").trim().toLowerCase();

  const outcome = await resetPassword(email, body.code ?? "", body.password ?? "");
  if (outcome === "weak-password") {
    return NextResponse.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  }
  // "no-account" and "bad-code" answer identically — distinguishing them would
  // confirm which addresses exist to anyone holding a wrong code.
  if (outcome !== "ok") {
    return NextResponse.json({ error: "That code is not right, or it has expired." }, { status: 400 });
  }

  logActivity({ email }, "auth.password.reset", "reset their password with an emailed code");
  return NextResponse.json({
    success: true,
    message: "Password changed. Sign in with it — you'll still be asked for your authenticator or passkey if you use one.",
  });
}
