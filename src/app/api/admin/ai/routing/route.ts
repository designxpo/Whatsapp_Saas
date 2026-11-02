import { NextResponse } from "next/server";
import { isAutoRouteEnabled, setAutoRoute, isToneEnabled, setToneEnabled } from "@/lib/aihub";
import { aiGate } from "@/lib/ai-gate";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — open to members. Never falls back to another business (ai-gate.ts).
export async function GET() {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  try {
    const [auto, tone] = await Promise.all([isAutoRouteEnabled(g.tid), isToneEnabled(g.tid)]);
    return NextResponse.json({ auto, tone });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST — AI behavior toggles. Body: { auto?: boolean, tone?: boolean }
// Tenant-wide bot behavior → admins only.
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let body: { auto?: boolean; tone?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (typeof body.auto === "boolean") await setAutoRoute(body.auto, g.tid);
    if (typeof body.tone === "boolean") await setToneEnabled(body.tone, g.tid);
    const [auto, tone] = await Promise.all([isAutoRouteEnabled(g.tid), isToneEnabled(g.tid)]);
    return NextResponse.json({ auto, tone });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
