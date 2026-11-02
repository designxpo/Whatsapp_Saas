import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { setTenantSetting } from "@/lib/store";
import { clearIsolationCache, isolationReport, ISOLATION_KEY, type IsolationMode } from "@/lib/isolation";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — is business isolation on, and what each channel answers with.
export async function GET() {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  try {
    const tid = g.tid;
    return NextResponse.json(await isolationReport(tid));
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { mode: "auto" | "on" | "off" } — admins only.
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let body: { mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const mode = body.mode as IsolationMode;
  if (!["auto", "on", "off"].includes(mode)) return NextResponse.json({ error: "mode must be auto, on or off" }, { status: 400 });
  try {
    const tid = g.tid;
    await setTenantSetting(tid, ISOLATION_KEY, mode);
    clearIsolationCache(tid);
    return NextResponse.json(await isolationReport(tid));
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
