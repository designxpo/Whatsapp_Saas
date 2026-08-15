import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { listContacts, getConversationByPhone } from "@/lib/store";
import { errorMessage } from "@/lib/errors";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// GET /api/inbox/contacts?q=priya&limit=20 — search the tenant's whole contact
// book, not just people who already have a chat open. This is what lets an agent
// message a past customer instead of waiting for one to write in.
// Auth: Authorization: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));

  try {
    const { data, total } = await listContacts({ search: q || null, limit, tenantId });
    // Flag who already has a conversation, so the panel can open the thread
    // instead of starting a new one.
    const contacts = await Promise.all(data.map(async c => {
      const conv = await getConversationByPhone(c.phone, tenantId).catch(() => null);
      return {
        id: c.id, name: c.name || c.phone, phone: c.phone, email: c.email,
        tags: c.tags, source: c.source, optedOut: c.status === "optedout",
        conversationId: conv?.id ?? null,
        platform: conv?.platform ?? null,
        lastInboundAt: conv?.lastInboundAt ?? null,
      };
    }));
    return NextResponse.json({ contacts, total });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
