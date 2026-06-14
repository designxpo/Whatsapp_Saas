import { NextResponse } from "next/server";
import { apiKeyOk } from "@/lib/apiauth";
import { getContactByPhone } from "@/lib/store";
import { fireTrigger } from "@/lib/autosend";
import { processEvent } from "@/lib/apirules";

// POST /api/events — the single entry point for API broadcasting.
// Body: { event: string, phone: string, name?: string, data?: object }
// 1) Runs every active API rule for this event (conditions on data/contact,
//    variable mapping from data, delay, send window, frequency cap).
// 2) Also fires legacy 'api_event' auto-sends with the same event name.
export async function POST(req: Request) {
  if (!apiKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { event?: string; phone?: string; name?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.event?.trim() || !body.phone?.trim()) return NextResponse.json({ error: "event and phone are required" }, { status: 400 });

  try {
    const rules = await processEvent({
      event: body.event.trim(),
      phone: body.phone.trim(),
      name: body.name,
      payload: body.data && typeof body.data === "object" ? body.data : {},
    }).catch(err => { console.error("[events] rules:", err); return []; });

    const contact = await getContactByPhone(body.phone);
    const legacyFired = await fireTrigger({
      trigger: "api_event",
      triggerKey: body.event.trim(),
      contactId: contact?.id ?? null,
      phone: body.phone.trim(),
      name: body.name ?? contact?.name ?? "",
    });

    return NextResponse.json({
      success: true,
      scheduled: rules.filter(r => r.outcome === "scheduled").length + (legacyFired ? 1 : 0),
      rules: rules.map(r => ({ rule: r.rule, outcome: r.outcome, detail: r.detail ?? null, sendAfter: r.sendAfter ?? null })),
      legacyAutomation: legacyFired,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
