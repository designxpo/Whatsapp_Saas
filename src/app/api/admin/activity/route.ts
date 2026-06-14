import { NextResponse } from "next/server";
import { requireRoleAdmin } from "@/lib/auth";
import { listActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?limit=200 — recent team activity, newest first. Admin-only.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const limit = parseInt(new URL(req.url).searchParams.get("limit") ?? "200", 10) || 200;
  return NextResponse.json({ activity: await listActivity(limit) });
}
