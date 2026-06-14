import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/store";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — dashboard aggregates. Degrades to zeros + notice when the DB is unreachable.
export async function GET() {
  try {
    return NextResponse.json({ analytics: await getAnalytics() });
  } catch (err) {
    const message = errorMessage(err);
    return NextResponse.json({
      analytics: null,
      notice: `Could not load analytics: ${message}`,
    });
  }
}
