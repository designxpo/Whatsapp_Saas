import { NextResponse } from "next/server";
import { getLocationOverrides, setLocationOverrides } from "@/lib/reviews";
import { getChannel } from "@/lib/channels";
import { currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

async function location(tid: string, channelId: string | null) {
  if (!channelId) return null;
  const ch = await getChannel(channelId, tid);
  return ch && ch.kind === "google_reviews" ? ch : null;
}

// GET ?channelId= — what this location sets for itself (anything missing uses
// the workspace's review settings).
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Workspace required" }, { status: 401 });
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  const ch = await location(tid, new URL(req.url).searchParams.get("channelId"));
  if (!ch) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  return NextResponse.json({ overrides: await getLocationOverrides(tid, ch.id) });
}

// POST { channelId, overrides } — replace this location's overrides; an empty
// object (or null) puts it back on the workspace's settings.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Workspace required" }, { status: 401 });
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  let body: { channelId?: string; overrides?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const ch = await location(tid, body.channelId ?? null);
  if (!ch) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  return NextResponse.json({ overrides: await setLocationOverrides(tid, ch.id, body.overrides ?? null) });
}
