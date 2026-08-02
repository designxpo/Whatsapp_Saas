import { NextResponse } from "next/server";
import { getPublicStatus } from "@/lib/publicstatus";

export const dynamic = "force-dynamic";

// GET — public, unauthenticated system status. Returns ONLY the shared
// background-job heartbeat, nothing tenant-identifying (contrast with
// /api/owner/health, which is owner-gated and full of per-tenant detail —
// that route must never be exposed here, even partially).
export async function GET() {
  const status = await getPublicStatus();
  return NextResponse.json(status);
}
