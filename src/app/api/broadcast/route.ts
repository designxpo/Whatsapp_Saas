export const maxDuration = 300;
import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { runBroadcast, BroadcastError, type BroadcastInput } from "@/lib/broadcast";

// POST /api/broadcast — server-to-server WhatsApp broadcasting.
// Auth: Authorization: Bearer <per-tenant ak_live_… key> (or legacy shared key).
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  let body: BroadcastInput;
  try { body = (await req.json()) as BroadcastInput; } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  try {
    return NextResponse.json(await runBroadcast(body, tenantId));
  } catch (err) {
    if (err instanceof BroadcastError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error("[broadcast]", err);
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
