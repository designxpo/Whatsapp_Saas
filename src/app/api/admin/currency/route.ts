import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getRates } from "@/lib/currency";

export const dynamic = "force-dynamic";

// GET ?from=INR&to=USD,EUR,GBP → latest FX rates (non-PII), for the catalog's
// converted-price hint. Best-effort: { rates: {} } on failure.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "INR";
  const to = (url.searchParams.get("to") || "USD,EUR").split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);
  try {
    const { base, rates } = await getRates(from, to);
    return NextResponse.json({ base, rates });
  } catch {
    return NextResponse.json({ base: from.toUpperCase(), rates: {} });
  }
}
