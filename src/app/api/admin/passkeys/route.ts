import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { deletePasskey, listPasskeys } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

// Your own passkeys only — this is not an admin view of everyone's.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { passkeys, available } = await listPasskeys(user.email);
  return NextResponse.json({
    available,
    passkeys: passkeys.map(p => ({
      id: p.id, deviceName: p.deviceName, backedUp: p.backedUp,
      createdAt: p.createdAt, lastUsedAt: p.lastUsedAt,
    })),
  });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "Which passkey?" }, { status: 400 });

  // deletePasskey is scoped to this email, so an id belonging to somebody else
  // matches nothing rather than deleting their key.
  await deletePasskey(user.email, body.id);
  logActivity(user, "auth.passkey.removed", "removed a passkey");
  return NextResponse.json({ success: true });
}
