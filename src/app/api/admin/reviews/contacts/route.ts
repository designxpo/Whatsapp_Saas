import { NextResponse } from "next/server";
import { reviewViewer } from "@/lib/review-access";
import { searchContacts } from "@/lib/review-cases";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// GET ?q= — this workspace's contacts matching a name or phone, so a person can
// pick and CONFIRM which customer wrote a review. Nothing is matched for them.
export async function GET(req: Request) {
  const v = await reviewViewer();
  if (!v) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!v.canManage) return NextResponse.json({ contacts: [] });
  const gate = await guardFeature(v.tenantId, "reviews");
  if (gate) return gate;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ contacts: await searchContacts(v.tenantId, q) });
}
