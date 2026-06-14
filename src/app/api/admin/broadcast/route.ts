export const maxDuration = 300;
import { NextResponse } from "next/server";
import { runBroadcast, BroadcastError, type BroadcastInput } from "@/lib/broadcast";
import { recipientsForAudience } from "@/lib/store";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";

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
    const r = await recipientsForAudience({ mode, tag: tag ?? undefined, key: key ?? undefined, value: value ?? undefined });
    return NextResponse.json({ count: r.length });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}

export async function POST(req: Request) {
  let body: BroadcastInput;
  try { body = (await req.json()) as BroadcastInput; } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }
  try {
    const result = await runBroadcast(body);
    logActivity(await currentUser(), "broadcast.send", `${body.templateName ?? "campaign"} → ${result.totalRecipients ?? 0} recipients (${result.status ?? ""})`);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BroadcastError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
