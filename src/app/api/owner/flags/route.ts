import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { listFlags, setFlag } from "@/lib/flags";
import { ownerAudit } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json({ flags: await listFlags() }); }
  catch (err) { return NextResponse.json({ flags: [], error: errorMessage(err) }); }
}

// POST { key, enabled } — flip a platform-wide flag.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { key?: string; enabled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.key?.trim() || typeof body.enabled !== "boolean") return NextResponse.json({ error: "key and enabled required" }, { status: 400 });
  try {
    await setFlag(body.key.trim(), body.enabled);
    await ownerAudit((await currentUser())?.email ?? "owner", "flag.toggle", null, `${body.key} → ${body.enabled ? "on" : "off"}`);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
