import { NextResponse } from "next/server";
import { listConversations, type ConvStatus } from "@/lib/store";
import { currentTenantId } from "@/lib/auth";
import { supportDeskTenantId } from "@/lib/supportdesk";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — list conversations for the inbox (optional ?status=active|paused|escalated).
// ?desk=support retargets the query at the support workspace — only the platform
// owner's session actually hops (supportDeskTenantId is a pass-through otherwise).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ConvStatus | null;
  try {
    const tid = url.searchParams.get("desk") === "support"
      ? await supportDeskTenantId()
      : await currentTenantId();
    // No valid session tenant → 401, never a fallback workspace. A revoked
    // member's cookie still passes the middleware signature check, and falling
    // back to DEFAULT_TENANT_ID would hand them the platform's own inbox.
    if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const conversations = await listConversations({ status, limit: 150, tenantId: tid });
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
