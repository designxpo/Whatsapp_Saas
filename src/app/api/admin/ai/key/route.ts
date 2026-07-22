export const maxDuration = 30;
import { NextResponse } from "next/server";
import { currentTenantId, DEFAULT_TENANT_ID, requireRoleAdmin } from "@/lib/auth";
import { getTenantAiStatus, saveTenantAi, clearTenantAi } from "@/lib/ai/keys";
import { validateKey, DEFAULT_CHAT_MODEL, type AiProvider } from "@/lib/ai/chat";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const PROVIDERS: AiProvider[] = ["gemini", "openai", "anthropic"];

// GET — masked status of the tenant's chat AI config (never returns the key).
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json(await getTenantAiStatus(tid));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — validate the key with a live test call, then store it encrypted.
// Body: { provider, apiKey, model? }
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { provider?: string; apiKey?: string; model?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const provider = body.provider as AiProvider;
  const apiKey = body.apiKey?.trim();
  if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "apiKey required" }, { status: 400 });
  const model = body.model?.trim() || DEFAULT_CHAT_MODEL[provider];

  try {
    // Fail fast on a bad key/model before persisting anything.
    await validateKey(provider, apiKey, model);
  } catch (err) {
    return NextResponse.json({ error: `Key validation failed: ${errorMessage(err)}` }, { status: 400 });
  }

  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await saveTenantAi(tid, provider, apiKey, model);
    return NextResponse.json(await getTenantAiStatus(tid));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — remove the tenant's key (AI chat turns off for them).
export async function DELETE() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await clearTenantAi(tid);
    return NextResponse.json(await getTenantAiStatus(tid));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
