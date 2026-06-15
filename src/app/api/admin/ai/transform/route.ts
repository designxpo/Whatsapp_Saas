export const maxDuration = 30;
import { NextResponse } from "next/server";
import { transformText } from "@/lib/llm";
import { listPrompts } from "@/lib/aihub";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — agent assist: apply an AI prompt to draft text in the inbox composer.
// Body: { promptId, text }
export async function POST(req: Request) {
  let body: { promptId?: string; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const text = body.text?.trim();
  if (!body.promptId || !text) return NextResponse.json({ error: "promptId and text required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const prompt = (await listPrompts(true, tid)).find(p => p.id === body.promptId);
    if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    const result = await transformText(prompt.prompt, text, tid);
    return NextResponse.json({ result: result || text });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
