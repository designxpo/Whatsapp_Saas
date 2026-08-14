import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { getConversation } from "@/lib/store";
import { credsFor, listChannels } from "@/lib/channels";
import { fetchTemplates } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Resolve WABA creds for a template lookup: the conversation's own number, else
// the tenant's DEFAULT WhatsApp number. undefined only when no number is connected.
async function waCreds(conversationId: string | null, tenantId: string) {
  if (conversationId) {
    const conv = await getConversation(conversationId, tenantId);
    if (conv?.channelId) {
      const c = await credsFor(conv.channelId, tenantId);
      if (c) return c;
    }
  }
  const wa = (await listChannels(tenantId)).filter(c => c.active && c.kind === "whatsapp");
  return wa.find(c => c.isDefault) ?? wa[0] ?? undefined;
}

// How many {{n}} placeholders the BODY has — the side-panel uses it to prompt
// for exactly that many values before enabling send.
function bodyParamCount(components: { type: string; text?: string }[]): number {
  const body = components?.find(c => c.type?.toUpperCase() === "BODY");
  const found = new Set((body?.text ?? "").match(/\{\{\s*(\d+)\s*\}\}/g) ?? []);
  return found.size;
}

// GET /api/inbox/templates?conversationId=… — the APPROVED templates the tenant
// can send on that thread's number (to answer once the 24h window has closed).
// Auth: Authorization: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const channel = await waCreds(new URL(req.url).searchParams.get("conversationId"), tenantId);
    if (!channel) return NextResponse.json({ templates: [], notice: "Connect a WhatsApp number first." });
    const all = await fetchTemplates(channel);
    const templates = all
      .filter(t => t.status === "APPROVED")
      .map(t => ({ name: t.name, language: t.language, category: t.category, params: bodyParamCount(t.components) }));
    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json({ templates: [], notice: `Could not load templates: ${err instanceof Error ? err.message : String(err)}` });
  }
}
