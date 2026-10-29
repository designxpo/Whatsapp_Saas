export const maxDuration = 30;
import { NextResponse } from "next/server";
import { findByToken, noteActivity } from "@/lib/inbound/store";
import { PROVIDERS } from "@/lib/inbound/providers";
import { ingestEvents } from "@/lib/inbound/ingest";
import { parseBody } from "@/lib/inbound/normalize";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// POST /api/inbound/<token> — where a business's connected tool (Shopify,
// Razorpay, Calendly, a Zapier step…) delivers its events.
//
// The token picks the connection and so the business; the tool's own signature
// proves the delivery came from that tool. Then each event is acted on once,
// for that business (src/lib/inbound/ingest.ts), every query naming it.
//
// Status codes are chosen for the sender's retry logic: an unknown URL or a
// bad signature is a 4xx the tool surfaces to whoever set it up; a paused
// connection or an event nobody acts on is a 200, because retrying those for
// two days helps nobody — and several tools switch a failing webhook off.

// No real tool sends anything near this; a body this size is abuse or a mistake.
const MAX_BODY_BYTES = 1_000_000;

// Connectors whose only credential is the token in the URL (no signature):
// a leaked URL could be used to message strangers, so they get a tighter limit.
const TOKEN_ONLY = new Set(["webhook", "indiamart"]);

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  // Per sender address, BEFORE any lookup: guessing URLs costs a database read each.
  const ipGate = await rateLimit(`inbound-ip:${clientIp(req)}`, { limit: 600, windowSec: 60 });
  if (!ipGate.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(ipGate.retryAfterSec) } });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Body too large" }, { status: 413 });

  const { token } = await params;
  const found = await findByToken(token);
  if (!found) return NextResponse.json({ error: "Unknown inbound URL" }, { status: 404 });
  const { row, secrets } = found;

  const provider = PROVIDERS[row.kind];
  if (!provider) return NextResponse.json({ error: "This integration is not available" }, { status: 404 });

  // Per connection, so one business's runaway loop cannot slow another's.
  const gate = await rateLimit(`inbound:${row.id}`, { limit: TOKEN_ONLY.has(row.kind) ? 60 : 300, windowSec: 60 });
  if (!gate.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  if (row.status === "paused") return NextResponse.json({ ok: true, paused: true });

  const body = parseBody(raw, req.headers.get("content-type"));
  if (!body) return NextResponse.json({ error: "Body is not JSON or form data" }, { status: 400 });

  const ctx = { headers: req.headers, raw, body, config: row.config, secrets };
  const refused = provider.verify(ctx);
  if (refused) {
    // Recorded on the connection, so the business sees why instead of silence.
    await noteActivity(row, { error: refused }).catch(() => undefined);
    return NextResponse.json({ error: refused }, { status: 401 });
  }

  let events;
  try {
    events = provider.parse(ctx);
  } catch (err) {
    const why = `Could not read this ${row.kind} event: ${err instanceof Error ? err.message : String(err)}`;
    await noteActivity(row, { error: why }).catch(() => undefined);
    return NextResponse.json({ error: why }, { status: 400 });
  }
  if (!events.length) return NextResponse.json({ ok: true, ignored: true });

  const results = await ingestEvents(row, events);
  // A failure a retry could fix asks for one; everything else is settled.
  // Counts only: the details name the business's automations, and are shown
  // to it in the portal, not to whoever holds this URL.
  const failed = results.some(r => r.outcome === "failed");
  const processed = results.filter(r => r.outcome === "processed").length;
  return NextResponse.json({ ok: !failed, received: results.length, processed }, { status: failed ? 500 : 200 });
}
