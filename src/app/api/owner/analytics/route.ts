import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { platformAnalytics } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json({ analytics: await platformAnalytics() }); }
  catch (err) { return NextResponse.json({ analytics: null, error: errorMessage(err) }); }
}
