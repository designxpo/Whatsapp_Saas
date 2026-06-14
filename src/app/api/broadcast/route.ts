export const maxDuration = 300;
import { NextResponse } from "next/server";
import { apiKeyOk } from "@/lib/apiauth";
import { runBroadcast, BroadcastError, type BroadcastInput } from "@/lib/broadcast";

// POST /api/broadcast — server-to-server WhatsApp broadcasting.
// Auth: Authorization: Bearer <BROADCAST_API_KEY>
export async function POST(req: Request) {
  if (!apiKeyOk(req)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  let body: BroadcastInput;
  try { body = (await req.json()) as BroadcastInput; } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  try {
    return NextResponse.json(await runBroadcast(body));
  } catch (err) {
    if (err instanceof BroadcastError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error("[broadcast]", err);
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
