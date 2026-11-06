import { NextResponse } from "next/server";
import { currentUser, currentTenantId, noSession } from "@/lib/auth";
import { listHandoffs, handoffNumber, type HandoffPlatform } from "@/lib/handoff";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
const PLATFORMS: HandoffPlatform[] = ["instagram", "facebook", "youtube"];

// GET ?platform= &days= &cursor= — one page of this workspace's WhatsApp
// handoffs with the range's totals (first page). ?setup=1 — only whether the
// workspace has a WhatsApp number for invitations, for the rule editors.
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url = new URL(req.url);
  const tid = await currentTenantId();
  if (!tid) return noSession();
  try {
    const num = await handoffNumber(tid);
    if (url.searchParams.get("setup")) return NextResponse.json({ number: num?.number ?? null });
    const platform = url.searchParams.get("platform") as HandoffPlatform;
    if (!PLATFORMS.includes(platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
    const r = await listHandoffs(tid, { platform, days: Number(url.searchParams.get("days")) || null, cursor: url.searchParams.get("cursor") });
    return NextResponse.json({ ...r, number: num?.number ?? null });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
