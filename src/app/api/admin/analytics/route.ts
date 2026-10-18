import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/store";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { parseRange } from "@/lib/analytics-range";

export const dynamic = "force-dynamic";

// GET — dashboard aggregates. Degrades to zeros + notice when the DB is unreachable.
export async function GET(req: Request) {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    // ?range=7d|14d|30d|90d|all — anything else falls to the default rather than erroring.
    const range = parseRange(new URL(req.url).searchParams.get("range"));
    return NextResponse.json({ analytics: await getAnalytics(tid, range) });
  } catch (err) {
    const message = errorMessage(err);
    return NextResponse.json({
      analytics: null,
      notice: `Could not load analytics: ${message}`,
    });
  }
}
