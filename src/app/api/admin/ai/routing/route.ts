import { NextResponse } from "next/server";
import { isAutoRouteEnabled, setAutoRoute, isToneEnabled, setToneEnabled } from "@/lib/aihub";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const [auto, tone] = await Promise.all([isAutoRouteEnabled(tid), isToneEnabled(tid)]);
    return NextResponse.json({ auto, tone });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST — AI behavior toggles. Body: { auto?: boolean, tone?: boolean }
export async function POST(req: Request) {
  let body: { auto?: boolean; tone?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    if (typeof body.auto === "boolean") await setAutoRoute(body.auto, tid);
    if (typeof body.tone === "boolean") await setToneEnabled(body.tone, tid);
    const [auto, tone] = await Promise.all([isAutoRouteEnabled(tid), isToneEnabled(tid)]);
    return NextResponse.json({ auto, tone });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
