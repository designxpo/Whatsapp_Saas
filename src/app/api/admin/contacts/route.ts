import { NextResponse } from "next/server";
import { listContacts, upsertContacts, getContactByPhone, type ContactAttrFilter } from "@/lib/store";
import { fireTrigger } from "@/lib/autosend";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { isLikelyValidE164, toDigits } from "@/lib/phone";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — CRM-style contact list. Supports search, tag, created-at window,
// last-seen window (last inbound message), and attribute conditions
// (?attrs=[{"key","op":"is"|"is_not"|"contains","value"}] JSON-encoded).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tag = url.searchParams.get("tag");
  const search = url.searchParams.get("search");
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "25", 10) || 25);
  let attrs: ContactAttrFilter[] = [];
  try {
    const raw = url.searchParams.get("attrs");
    if (raw) attrs = (JSON.parse(raw) as ContactAttrFilter[]).filter(a => a?.key && ["is", "is_not", "contains"].includes(a.op)).slice(0, 10);
  } catch { /* malformed attrs → ignore */ }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const { data, total } = await listContacts({
      tag, search, offset, limit, attrs, tenantId: tid,
      createdFrom: url.searchParams.get("createdFrom"),
      createdTo: url.searchParams.get("createdTo"),
      seenFrom: url.searchParams.get("seenFrom"),
      seenTo: url.searchParams.get("seenTo"),
    });
    return NextResponse.json({ contacts: data, total });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — import a batch of contacts (from CSV parsed client-side).
// Body: { contacts: [{ phone, name?, email?, tags?, attributes? }] }
// Extra CSV columns arrive as attributes and land on contacts.attributes.
export async function POST(req: Request) {
  let body: { contacts?: { phone: string; name?: string; email?: string; tags?: string[]; attributes?: Record<string, string> }[]; consent?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const allRows = Array.isArray(body.contacts) ? body.contacts : [];
  if (allRows.length === 0) return NextResponse.json({ error: "contacts[] required" }, { status: 400 });
  // Drop numbers that aren't valid E.164 (leading 0, too short/long) BEFORE they
  // can be broadcast to — sending to them spikes Meta errors and hurts the
  // quality rating. We report the count instead of silently importing them.
  const rows = allRows.filter(r => isLikelyValidE164(toDigits(r.phone)));
  const invalid = allRows.length - rows.length;
  if (rows.length === 0) return NextResponse.json({ error: `All ${invalid} number(s) were invalid. Use full international format with country code, e.g. 919876543210.`, invalid }, { status: 400 });
  // Enforce the plan's contact cap (counts the batch being added).
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try { await enforceLimit(tid, "contacts", rows.length); }
  catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }
  try {
    // consent=true means the tenant attested these contacts opted in to receive
    // messages. Without it, imports are stored not-opted-in and excluded from
    // marketing audiences until consent is established (e.g. they reply).
    const result = await upsertContacts(rows, "import", tid, body.consent ? { consented: true, proof: "Importer attested consent" } : undefined);
    // Fire 'contact_added' automation for newly imported contacts.
    for (const r of rows) {
      const c = await getContactByPhone(r.phone, tid);
      if (c && c.source === "import") {
        await fireTrigger({ trigger: "contact_added", triggerKey: null, contactId: c.id, phone: c.phone, name: c.name }, tid).catch(() => undefined);
      }
    }
    logActivity(await currentUser(), "contacts.import", `${result.inserted} added, ${result.skipped} skipped, ${invalid} invalid`);
    return NextResponse.json({ success: true, ...result, invalid });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
