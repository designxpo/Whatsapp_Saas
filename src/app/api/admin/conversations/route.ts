import { NextResponse } from "next/server";
import { listConversations, type ConvStatus } from "@/lib/store";
import { currentUser, currentTenantId } from "@/lib/auth";
import { supportDeskTenantId } from "@/lib/supportdesk";
import { visibleChannelIds, resolveChannelScope } from "@/lib/teams";
import { stagesByPhone } from "@/lib/pipeline";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — list conversations for the inbox.
//   ?status=active|paused|escalated   status filter
//   ?channelId=<uuid>                 show only this number's chats
//   ?desk=support                     retarget at the support workspace — only the
//                                     platform owner's session actually hops
//                                     (supportDeskTenantId is a pass-through otherwise)
//
// The number filter is enforced here, not trusted from the client: a member can
// be scoped to their own team's numbers, so asking for someone else's number is
// a 403 rather than a silent fallback to their own — a silent fallback looks
// like the chats disappeared.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ConvStatus | null;
  const requested = url.searchParams.get("channelId");
  try {
    const tid = url.searchParams.get("desk") === "support"
      ? await supportDeskTenantId()
      : await currentTenantId();
    // No valid session tenant → 401, never a fallback workspace. A revoked
    // member's cookie still passes the middleware signature check, and falling
    // back to DEFAULT_TENANT_ID would hand them the platform's own inbox.
    if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await currentUser();
    const allowed = await visibleChannelIds(user);
    const scope = resolveChannelScope(allowed, requested);
    if (scope.denied) {
      return NextResponse.json({ error: "That number belongs to another team" }, { status: 403 });
    }
    const conversations = await listConversations({ status, limit: 150, tenantId: tid, channelIds: scope.ids });
    // Pipeline stage per chat, so the inbox shows WHERE each lead is, not just
    // which number it came in on. One batched query for the whole page —
    // best-effort, because a missing pipeline table must not blank the inbox.
    const stages = await stagesByPhone(conversations.map(c => c.phone), tid).catch(() => ({}));
    return NextResponse.json({ conversations, stages, scopedToTeam: user?.team ?? null });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
