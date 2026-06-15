import { NextResponse } from "next/server";
import { listConversations, type ConvStatus } from "@/lib/store";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — list conversations for the inbox (optional ?status=active|paused|escalated).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ConvStatus | null;
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const conversations = await listConversations({ status, limit: 150, tenantId: tid });
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
