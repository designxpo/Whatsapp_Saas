import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { listQuickReplies } from "@/lib/store";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// GET /api/inbox/quick-replies — the tenant's saved canned replies, so the
// extension's composer offers the same one-tap answers as the portal.
// Auth: Authorization: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  try {
    const quickReplies = (await listQuickReplies(tenantId)).map(q => ({ id: q.id, shortcut: q.shortcut, body: q.body }));
    return NextResponse.json({ quickReplies });
  } catch (err) {
    // A missing table or transient read shouldn't break the composer.
    return NextResponse.json({ quickReplies: [], notice: err instanceof Error ? err.message : String(err) });
  }
}
