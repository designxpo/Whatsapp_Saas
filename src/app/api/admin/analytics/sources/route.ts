import { NextResponse } from "next/server";
import { parseRange } from "@/lib/analytics-range";
import { getLeadSources } from "@/lib/leadsources";
import { errorMessage } from "@/lib/errors";
import { currentTenantId } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getChannel as tenantChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET ?range=7d|14d|30d|90d|all — where this window's conversations came from.
//
// Its own route rather than part of /analytics: this one pages the contacts
// and conversations tables, and the main dashboard should not wait on it. The
// panel fetches it when it renders.
export async function GET(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });

  const range = parseRange(new URL(req.url).searchParams.get("range"));
  try {
    return NextResponse.json({ sources: await getLeadSources(range, tenantId) });
  } catch (err) {
    // getLeadSources already degrades to zeros; this is the belt for anything
    // thrown before it (a bad range, a dead client). A panel that errors must
    // not take the dashboard down with it.
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
