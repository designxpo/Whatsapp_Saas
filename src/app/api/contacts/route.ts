import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { upsertContacts, getContactByPhone } from "@/lib/store";
import { fireTrigger } from "@/lib/autosend";

// POST /api/contacts — push contacts in (server-to-server).
// Body: { contacts: [{ phone, name?, email?, tags? }] }
// Newly-added contacts fire the 'contact_added' auto-send (if configured).
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { contacts?: { phone: string; name?: string; email?: string; tags?: string[] }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const rows = Array.isArray(body.contacts) ? body.contacts : [];
  if (rows.length === 0) return NextResponse.json({ error: "contacts[] required" }, { status: 400 });

  try {
    const result = await upsertContacts(rows, "api", tenantId);
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
