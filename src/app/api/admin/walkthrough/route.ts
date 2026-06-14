import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// POST — mark the current tenant as having completed the product walkthrough.
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { await db().from("tenants").update({ onboarded: true }).eq("id", user.tenantId); }
  catch { /* best-effort */ }
  return NextResponse.json({ success: true });
}
