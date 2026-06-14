import { NextResponse } from "next/server";
import { processEvent } from "@/lib/apirules";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — dry-run an event against the active rules WITHOUT scheduling anything.
// Body: { event, phone, name?, data? }. Returns which rules match, the resolved
// template variables, and when each send would go out.
export async function POST(req: Request) {
  let body: { event?: string; phone?: string; name?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.event?.trim() || !body.phone?.trim()) return NextResponse.json({ error: "event and phone are required" }, { status: 400 });
  try {
    const results = await processEvent({
      event: body.event.trim(),
      phone: body.phone.trim(),
      name: body.name,
      payload: body.data && typeof body.data === "object" ? body.data : {},
      dryRun: true,
    });
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
