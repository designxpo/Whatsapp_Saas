import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { rateLimit, apiPerKey } from "@/lib/ratelimit";
import { getContactByPhone } from "@/lib/store";
import { fireTrigger } from "@/lib/autosend";
import { processEvent } from "@/lib/apirules";
import { claimIdempotency, completeIdempotency, readIdempotencyKey, requestHash } from "@/lib/idempotency";

// POST /api/events — the single entry point for API broadcasting.
// Body: { event: string, phone: string, name?: string, data?: object }
// 1) Runs every active API rule for this event (conditions on data/contact,
//    variable mapping from data, delay, send window, frequency cap).
// 2) Also fires legacy 'api_event' auto-sends with the same event name.
//
// Idempotency-Key (optional): a retry with the same key and body gets the first
// answer back and schedules nothing — so a caller that lost our response (a
// timeout, a dropped connection) can safely send again. Mezmitra always sends one.
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per TENANT, not per key: the budget belongs to the account, and a bucket
  // name must never carry secret material. A leaked key sends WhatsApp
  // messages, which costs money AND sender reputation — and reputation does
  // not come back, so this is capped per minute rather than per day.
  const rl = await rateLimit(`api:${tenantId}`, apiPerKey());
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded. Slow down and retry." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const idem = readIdempotencyKey(req.headers.get("idempotency-key"));
  if (idem.error) return NextResponse.json({ error: idem.error }, { status: 400 });
  const raw = await req.text();
  let body: { event?: string; phone?: string; name?: string; data?: Record<string, unknown> };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body?.event?.trim() || !body.phone?.trim()) return NextResponse.json({ error: "event and phone are required" }, { status: 400 });

  if (idem.key) {
    const claim = await claimIdempotency(tenantId, idem.key, requestHash(raw));
    if (claim.kind === "replay") return NextResponse.json(claim.body, { status: claim.status, headers: { "Idempotent-Replayed": "true" } });
    if (claim.kind === "busy") return NextResponse.json({ error: "The first request with this Idempotency-Key is still being processed" }, { status: 409 });
    if (claim.kind === "mismatch") return NextResponse.json({ error: "This Idempotency-Key was used for a different request" }, { status: 422 });
  }
  const answer = async (status: number, payload: unknown) => {
    if (idem.key) await completeIdempotency(tenantId, idem.key, status, payload);
    return NextResponse.json(payload, { status });
  };

  try {
    const rules = await processEvent({
      event: body.event.trim(),
      phone: body.phone.trim(),
      name: body.name,
      payload: body.data && typeof body.data === "object" ? body.data : {},
    }, tenantId).catch(err => { console.error("[events] rules:", err); return []; });

    const contact = await getContactByPhone(body.phone, tenantId);
    const legacyFired = await fireTrigger({
      trigger: "api_event",
      triggerKey: body.event.trim(),
      contactId: contact?.id ?? null,
      phone: body.phone.trim(),
      name: body.name ?? contact?.name ?? "",
    }, tenantId);

    return answer(200, {
      success: true,
      scheduled: rules.filter(r => r.outcome === "scheduled").length + (legacyFired ? 1 : 0),
      rules: rules.map(r => ({ rule: r.rule, outcome: r.outcome, detail: r.detail ?? null, sendAfter: r.sendAfter ?? null })),
      legacyAutomation: legacyFired,
    });
  } catch (err) {
    return answer(500, { error: String(err) });
  }
}
