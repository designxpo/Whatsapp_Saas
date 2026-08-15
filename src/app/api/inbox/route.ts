import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { listConversations, type Conversation, type ConvPlatform } from "@/lib/store";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PLATFORMS: ConvPlatform[] = ["whatsapp", "instagram", "messenger", "webchat"];
const STATUSES = ["all", "needs_reply", "escalated", "bot_off"] as const;
type StatusFilter = (typeof STATUSES)[number];
// Count over a wide slice so the tallies describe the whole recent inbox, not
// just the page being displayed.
const COUNT_DEPTH = 200;

const matchesStatus = (c: Conversation, f: StatusFilter) =>
  f === "all" ? true
  : f === "needs_reply" ? !!c.needsReply
  : f === "escalated" ? c.status === "escalated"
  : !c.botEnabled;   // bot_off = a human has taken over

// GET /api/inbox — the tenant's conversations, mirroring the portal's Live Chat
// filters so the extension and the portal never disagree about what's in the inbox.
// Auth: Authorization: Bearer <ak_live_… key>.
//
// Query: ?limit=50
//        &view=chats|comments               (default chats — comments are IG/FB
//                                            comment threads, counted separately
//                                            in the portal too)
//        &platform=whatsapp|instagram|messenger|webchat
//        &status=all|needs_reply|escalated|bot_off
//        &q=<name or number>
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  const view = sp.get("view") === "comments" ? "comments" : "chats";
  const platform = PLATFORMS.find(p => p === sp.get("platform")) ?? null;
  const status = STATUSES.find(s => s === sp.get("status")) ?? "all";
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  try {
    const all = await listConversations({ tenantId, limit: COUNT_DEPTH });

    // Chats vs comments is the outermost split (as in the portal), so every
    // count below describes the view the caller is actually looking at.
    const chats = all.filter(c => !c.isComment);
    const comments = all.filter(c => !!c.isComment);
    const inView = view === "comments" ? comments : chats;

    const searched = q
      ? inView.filter(c => `${c.name ?? ""} ${c.phone ?? ""} ${c.handle ?? ""}`.toLowerCase().includes(q))
      : inView;
    // Channel counts honour the status filter and search, so each tab's number
    // matches what clicking it shows.
    const base = searched.filter(c => matchesStatus(c, status));
    const counts: Record<string, number> = {
      all: base.length,
      chats: chats.length,
      comments: comments.length,
      needsReply: inView.filter(c => c.needsReply).length,
      escalated: inView.filter(c => c.status === "escalated").length,
      botOff: inView.filter(c => !c.botEnabled).length,
    };
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
        // 24-hour customer-service window: free-form text is only allowed while open.
        const windowOpen = !!inboundAt && now - inboundAt < WINDOW_MS;
        return {
          id: c.id,
          name: c.name || c.phone || c.handle || "Unknown",
          phone: c.phone,
          handle: c.handle,
          platform: c.platform ?? "whatsapp",
          avatarUrl: c.avatarUrl,
          isComment: !!c.isComment,
          status: c.status,
          labels: c.labels ?? [],
          lastMessage: c.lastMessage,
          lastInboundAt: c.lastInboundAt,
          lastOutboundAt: c.lastOutboundAt,
          needsReply: c.needsReply,
          botEnabled: c.botEnabled,
          windowOpen,
          windowClosesAt: windowOpen ? new Date(inboundAt + WINDOW_MS).toISOString() : null,
        };
      });

    return NextResponse.json({ conversations, counts, view, platform, status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
