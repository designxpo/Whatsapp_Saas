import { NextResponse } from "next/server";
import { listOptouts, addOptout, removeOptout } from "@/lib/store";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET() {
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  return NextResponse.json({ optouts: await listOptouts(tid) });
}

export async function POST(req: Request) {
  let body: { phone?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone?.trim()) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  await addOptout(body.phone.trim(), body.reason, tid);
  logActivity(await currentUser(), "optout.add", body.phone.trim());
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  let body: { phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone?.trim()) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  await removeOptout(body.phone.trim(), tid);
  logActivity(await currentUser(), "optout.remove", body.phone.trim());
  return NextResponse.json({ success: true });
}
