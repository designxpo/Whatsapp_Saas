import { NextResponse } from "next/server";
import { listFlows, createFlow } from "@/lib/flowengine";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — all flows (builder list view).
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ flows: await listFlows(tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — create an empty flow. Body: { name }
export async function POST(req: Request) {
  let body: { name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ flow: await createFlow(name, tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
