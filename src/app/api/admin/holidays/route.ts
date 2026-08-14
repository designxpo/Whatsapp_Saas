import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { upcomingHolidays } from "@/lib/holidays";

export const dynamic = "force-dynamic";

// GET ?country=IN&days=90 → upcoming public holidays / festivals (non-PII), for
// the broadcast composer's festival-greeting planner. Best-effort: [] on failure.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const country = ((url.searchParams.get("country") || "IN").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2)) || "IN";
  const days = Math.min(400, Math.max(1, parseInt(url.searchParams.get("days") || "90", 10) || 90));
  try {
    const holidays = await upcomingHolidays(country, days);
    return NextResponse.json({ holidays });
  } catch {
    return NextResponse.json({ holidays: [] });
  }
}
