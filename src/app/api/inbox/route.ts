import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { listConversations, type ConvPlatform } from "@/lib/store";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PLATFORMS: ConvPlatform[] = ["whatsapp", "instagram", "messenger", "webchat"];
// Count over a wide slice so the channel tallies describe the whole recent
// inbox, not just the page being displayed (a tenant with mostly WhatsApp would
// otherwise show "Instagram 0" purely because IG chats fell off the first page).
const COUNT_DEPTH = 200;

// GET /api/inbox — the tenant's recent conversations, for the extension's
// side-panel inbox. Auth: Authorization: Bearer <ak_live_… key>.
// Query: ?limit=40&needsReply=1&platform=whatsapp|instagram|messenger|webchat
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 40));
  const needsReplyOnly = url.searchParams.get("needsReply") === "1";
  const asked = url.searchParams.get("platform");
  const platform = PLATFORMS.find(p => p === asked) ?? null;

  try {
    const all = await listConversations({ tenantId, limit: COUNT_DEPTH });
    // Counts describe what each channel tab WOULD show, so they honour the
    // needs-reply toggle but not the channel choice itself.
    const base = needsReplyOnly ? all.filter(c => c.needsReply) : all;
    const counts: Record<string, number> = { all: base.length, needsReply: all.filter(c => c.needsReply).length };
    for (const p of PLATFORMS) counts[p] = 0;
    for (const c of base) {
      const p = (c.platform ?? "whatsapp") as ConvPlatform;
      if (p in counts) counts[p] += 1;
    }

    const now = Date.now();
    const conversations = (platform ? base.filter(c => (c.platform ?? "whatsapp") === platform) : base)
      .slice(0, limit)
      .map(c => {
        const inboundAt = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0;
        // 24-hour customer-service window: free-form text is only allowed while
        // open. Only WhatsApp is sendable from the extension today.
        const windowOpen = !!inboundAt && now - inboundAt < WINDOW_MS;
        return {
          id: c.id,
          name: c.name || c.phone || c.handle || "Unknown",
          phone: c.phone,
          platform: c.platform ?? "whatsapp",
          avatarUrl: c.avatarUrl,
          lastMessage: c.lastMessage,
          lastInboundAt: c.lastInboundAt,
          lastOutboundAt: c.lastOutboundAt,
          needsReply: c.needsReply,
          botEnabled: c.botEnabled,
          windowOpen,
          windowClosesAt: windowOpen ? new Date(inboundAt + WINDOW_MS).toISOString() : null,
        };
      });

    return NextResponse.json({ conversations, counts, platform });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
