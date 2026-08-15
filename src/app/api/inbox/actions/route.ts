import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { getConversation, setBotEnabled, setConversationStatus } from "@/lib/store";
import { errorMessage } from "@/lib/errors";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// POST /api/inbox/actions — the non-sending thread controls the portal's Live
// Chat offers, so an agent can hand a chat to a human (or take the AI off it)
// without leaving the page they're on. Auth: Bearer <ak_live_… key>.
//
// Body: { conversationId, action: "bot",    enabled: boolean }
//       { conversationId, action: "status", status: "escalated" | "active" }
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  let body: { conversationId?: string; action?: string; enabled?: boolean; status?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });

  try {
    // Tenant-scoped read first — never act on another workspace's conversation.
    const conv = await getConversation(body.conversationId, tenantId);
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    if (body.action === "bot") {
      const enabled = !!body.enabled;
      await setBotEnabled(conv.id, enabled);
      return NextResponse.json({ success: true, botEnabled: enabled });
    }

    if (body.action === "status") {
      const status = body.status === "escalated" ? "escalated" : body.status === "active" ? "active" : null;
      if (!status) return NextResponse.json({ error: "status must be 'escalated' or 'active'" }, { status: 400 });
      await setConversationStatus(conv.id, status);
      // Escalating means a person is taking it — stop the AI too, as the portal does.
      if (status === "escalated" && conv.botEnabled) await setBotEnabled(conv.id, false);
      return NextResponse.json({ success: true, status });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
