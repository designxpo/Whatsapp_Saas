import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdContext, setAdContext } from "@/lib/adchats";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// The tenant's saved standing context for the AI ad builder — ONE small
// wa_settings row (not a growing table), reused across every future chat.

export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ context: await getAdContext(tid) });
  } catch (err) {
    return NextResponse.json({ context: "", error: errorMessage(err) });
  }
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let b: { context?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await setAdContext(String(b.context ?? ""), tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
