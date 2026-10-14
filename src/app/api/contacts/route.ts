import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { rateLimit, apiPerKey } from "@/lib/ratelimit";
import { upsertContacts, getContactByPhone } from "@/lib/store";
import { fireTrigger } from "@/lib/autosend";

// POST /api/contacts — push contacts in (server-to-server).
// Body: { contacts: [{ phone, name?, email?, tags? }] }
// Newly-added contacts fire the 'contact_added' auto-send (if configured).
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per TENANT, not per key: the budget belongs to the account, and a bucket
  // name must never carry secret material. A leaked key sends WhatsApp
  // messages, which costs money AND sender reputation — and reputation does
  // not come back, so this is capped per minute rather than per day.
  const rl = await rateLimit(`api:${tenantId}`, apiPerKey());
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded. Slow down and retry." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  let body: { contacts?: { phone: string; name?: string; email?: string; tags?: string[] }[]; consent?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const rows = Array.isArray(body.contacts) ? body.contacts : [];
  if (rows.length === 0) return NextResponse.json({ error: "contacts[] required" }, { status: 400 });

  try {
    // Pass consent:true only when the integration attests these contacts opted in;
    // otherwise they're stored not-opted-in and excluded from marketing audiences.
    const result = await upsertContacts(rows, "api", tenantId, body.consent ? { consented: true, proof: "API attested consent" } : undefined);
    // Fire 'contact_added' automation for the newly inserted contacts.
    // (Upsert ignore-duplicates means only genuinely new phones get nudged.)
    for (const r of rows) {
      const c = await getContactByPhone(r.phone, tenantId);
      if (c && c.source === "api") {
        await fireTrigger({ trigger: "contact_added", triggerKey: null, contactId: c.id, phone: c.phone, name: c.name }, tenantId).catch(() => undefined);
      }
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
