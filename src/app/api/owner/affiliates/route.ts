import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { ownerAffiliateStats } from "@/lib/affiliates";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json({ affiliates: await ownerAffiliateStats() }); }
  catch (err) { return NextResponse.json({ affiliates: [], error: errorMessage(err) }); }
}
