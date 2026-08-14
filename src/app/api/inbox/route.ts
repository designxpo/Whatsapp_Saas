import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { listConversations } from "@/lib/store";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// GET /api/inbox — the tenant's recent conversations, for the extension's
// side-panel inbox. Auth: Authorization: Bearer <ak_live_… key>.
// Query: ?limit=40&needsReply=1
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 40));
  const needsReplyOnly = url.searchParams.get("needsReply") === "1";

  try {
    let convs = await listConversations({ tenantId, limit });
    if (needsReplyOnly) convs = convs.filter(c => c.needsReply);
    const now = Date.now();
    const conversations = convs.map(c => ({
      id: c.id,
      name: c.name || c.phone || c.handle || "Unknown",
      phone: c.phone,
      platform: c.platform,
      avatarUrl: c.avatarUrl,
      lastMessage: c.lastMessage,
      lastInboundAt: c.lastInboundAt,
      lastOutboundAt: c.lastOutboundAt,
      needsReply: c.needsReply,
      botEnabled: c.botEnabled,
      // 24-hour customer-service window: free-form text is only allowed while open.
      windowOpen: !!c.lastInboundAt && now - new Date(c.lastInboundAt).getTime() < WINDOW_MS,
    }));
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
