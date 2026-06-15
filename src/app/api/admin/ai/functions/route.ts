import { NextResponse } from "next/server";
import { listFunctions, saveFunction, deleteFunction, type AiFunctionParam } from "@/lib/aihub";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; return NextResponse.json({ functions: await listFunctions(false, tid) }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST — create/update a function definition (id present → update).
export async function POST(req: Request) {
  let body: { id?: string; name?: string; description?: string; parameters?: AiFunctionParam[]; webhookUrl?: string; escalate?: boolean; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await saveFunction({ ...body, name: body.name }, tid);
    return NextResponse.json({ functions: await listFunctions(false, tid) });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; await deleteFunction(body.id, tid); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
