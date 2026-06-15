import { NextResponse } from "next/server";
import { listPrompts, savePrompt, deletePrompt } from "@/lib/aihub";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; return NextResponse.json({ prompts: await listPrompts(false, tid) }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function POST(req: Request) {
  let body: { id?: string; name?: string; prompt?: string; active?: boolean; sort?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.prompt?.trim()) return NextResponse.json({ error: "name and prompt required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await savePrompt({ ...body, name: body.name, prompt: body.prompt }, tid);
    return NextResponse.json({ prompts: await listPrompts(false, tid) });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; await deletePrompt(body.id, tid); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
