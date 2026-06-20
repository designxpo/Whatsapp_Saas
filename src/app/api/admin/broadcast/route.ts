export const maxDuration = 300;
import { NextResponse } from "next/server";
import { runBroadcast, BroadcastError, type BroadcastInput } from "@/lib/broadcast";
import { recipientsForAudience } from "@/lib/store";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { checkLimit } from "@/lib/usage";
import { guardFeature, guardAccount } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?mode=all|tag|attribute&tag=…&key=…&value=… → recipient count preview.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const tag = url.searchParams.get("tag");
  const key = url.searchParams.get("key");
  const value = url.searchParams.get("value");
  if (mode !== "all" && mode !== "tag" && mode !== "attribute") return NextResponse.json({ count: 0 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    // Marketing audience → opted-in only, so the preview count matches the send.
    const r = await recipientsForAudience({ mode, tag: tag ?? undefined, key: key ?? undefined, value: value ?? undefined }, tid, true);
    return NextResponse.json({ count: r.length });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}

export async function POST(req: Request) {
  let body: BroadcastInput;
  try { body = (await req.json()) as BroadcastInput; } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  { const tid0 = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const acct = await guardAccount(tid0); if (acct) return acct;
    const gate = await guardFeature(tid0, "broadcasts"); if (gate) return gate; }
  // Enforce the monthly-message cap before sending (best-effort recipient count).
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const c = await checkLimit(tid, "messages", 0);
    if (!c.allowed) return NextResponse.json({ success: false, error: `You've reached your plan's monthly message limit (${c.used}/${c.limit}). Upgrade to send more.`, upgrade: true }, { status: 402 });
  } catch (e) { console.error("[broadcast] limit check", errorMessage(e)); }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const result = await runBroadcast(body, tid);
    logActivity(await currentUser(), "broadcast.send", `${body.templateName ?? "campaign"} → ${result.totalRecipients ?? 0} recipients (${result.status ?? ""})`);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BroadcastError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
