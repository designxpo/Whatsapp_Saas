import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { securityReport } from "@/lib/securityposture";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// How many rows the screen gets. The counts cover every account; the list is
// for working through, riskiest first, and a fleet-sized table helps nobody.
const MAX_ROWS = 300;

// Every account's sign-in security, one row per business (lib/securityposture.ts).
// Owner-gated here as well as by the owner layout: this route is addressable
// directly. Counts and a level only, never anyone's name or email.
export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const r = await securityReport();
    const level = new URL(req.url).searchParams.get("level");
    const rows = level ? r.accounts.filter(a => a.level === level) : r.accounts;
    return NextResponse.json({
      available: r.available, problem: r.problem, counts: r.counts,
      accounts: rows.slice(0, MAX_ROWS), matching: rows.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) || "Could not read sign-in security" }, { status: 500 });
  }
}
