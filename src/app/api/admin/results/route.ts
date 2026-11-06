import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { resultsReport } from "@/lib/results";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?days=7|30|90 — business results for the period. Admins only (revenue).
export async function GET(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (ctx.v.user.role !== "admin") return NextResponse.json({ error: "Only an admin can see results." }, { status: 403 });
  const d = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(d) ? d : 30;
  try { return NextResponse.json(await resultsReport(ctx.v.tenantId, days), { headers: { "Cache-Control": "no-store" } }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
