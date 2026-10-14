export const maxDuration = 300;
import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { rateLimit, apiPerKey } from "@/lib/ratelimit";
import { runBroadcast, BroadcastError, type BroadcastInput } from "@/lib/broadcast";

// POST /api/broadcast — server-to-server WhatsApp broadcasting.
// Auth: Authorization: Bearer <per-tenant ak_live_… key> (or legacy shared key).
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  // Per TENANT, not per key: the budget belongs to the account, and a bucket
  // name must never carry secret material. A leaked key sends WhatsApp
  // messages, which costs money AND sender reputation — and reputation does
  // not come back, so this is capped per minute rather than per day.
  const rl = await rateLimit(`api:${tenantId}`, apiPerKey());
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Rate limit exceeded. Slow down and retry." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
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
