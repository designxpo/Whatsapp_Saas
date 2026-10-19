export const maxDuration = 300;
import { NextResponse } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { sweepInstagramTokens } from "@/lib/igtokensweep";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Keep long-lived Instagram tokens alive — see igtokensweep.ts. The main engine
// (process-queue) also runs this sweep every few hours, so this daily GitHub job
// is a second clock, not the only one.

const DEADLINE = 240_000;               // leave headroom inside the 300s budget

export async function POST(req: Request) {
  if (!cronOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  try {
    const result = await sweepInstagramTokens(startedAt + DEADLINE);
    return NextResponse.json({ ok: true, ...result, tookMs: Date.now() - startedAt });
  } catch (e) {
    console.error("[cron channel-tokens] sweep failed", e);
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
