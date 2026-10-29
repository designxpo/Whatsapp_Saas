import { NextResponse } from "next/server";
import { currentTenantId, DEFAULT_TENANT_ID, requireRoleAdmin } from "@/lib/auth";
import { setTenantSetting } from "@/lib/store";
import { clearIsolationCache, isolationReport, ISOLATION_KEY, type IsolationMode } from "@/lib/isolation";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — is business isolation on, and what each channel answers with.
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json(await isolationReport(tid));
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { mode: "auto" | "on" | "off" } — admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Only admins can change this" }, { status: 403 });
  let body: { mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const mode = body.mode as IsolationMode;
  if (!["auto", "on", "off"].includes(mode)) return NextResponse.json({ error: "mode must be auto, on or off" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await setTenantSetting(tid, ISOLATION_KEY, mode);
    clearIsolationCache(tid);
    return NextResponse.json(await isolationReport(tid));
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
