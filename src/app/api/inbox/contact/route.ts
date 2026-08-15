import { NextResponse, after } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { getConversation, getContactByPhone, getContactByPhoneLoose, updateContactProfile } from "@/lib/store";
import { listOrders } from "@/lib/commerce";
import { listStages, getContactStage, moveContact, applyStageEffects } from "@/lib/pipeline";
import { errorMessage } from "@/lib/errors";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Resolve the contact behind a conversation id or a raw phone. Instagram chats
// are keyed by IGSID, so fall back to the phone the lead shared in chat.
async function resolveContact(tenantId: string, conversationId: string | null, phoneParam: string | null) {
  let phone = (phoneParam ?? "").replace(/\D/g, "");
  if (!phone && conversationId) {
    const conv = await getConversation(conversationId, tenantId);
    phone = (conv?.leadPhone || conv?.phone || "").replace(/\D/g, "");
  }
  if (!phone) return null;
  return (await getContactByPhone(phone, tenantId)) ?? (await getContactByPhoneLoose(phone, tenantId));
}

// GET /api/inbox/contact?conversationId=… (or ?phone=…)
// The context an agent needs before answering: who this is, what they've bought,
// and where they sit in the pipeline. Auth: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  const sp = new URL(req.url).searchParams;

  try {
    const contact = await resolveContact(tenantId, sp.get("conversationId"), sp.get("phone"));
    const stages = (await listStages(tenantId).catch(() => [])).map(s => ({ id: s.id, name: s.name }));
    if (!contact) return NextResponse.json({ contact: null, orders: null, pipeline: { stageId: null, stageName: null, stages } });

    // Orders for this phone. listOrders' search is a phone ILIKE, so re-check
    // exactly — a substring match could pull in a different customer's order.
    const all = await listOrders(tenantId, { search: contact.phone, limit: 100 }).catch(() => []);
    const mine = all.filter(o => o.phone.replace(/\D/g, "") === contact.phone.replace(/\D/g, ""));
    const earned = mine.filter(o => o.status === "paid" || o.status === "fulfilled");
    const last = mine[0];

    const { stageId, stageName } = await getContactStage(contact.id, tenantId).catch(() => ({ stageId: null, stageName: null }));

    return NextResponse.json({
      contact: {
        id: contact.id, name: contact.name, phone: contact.phone, email: contact.email,
        tags: contact.tags, attributes: contact.attributes, optedOut: contact.status === "optedout",
        source: contact.source, createdAt: contact.createdAt,
        note: contact.attributes?.note ?? "",
      },
      orders: {
        count: mine.length,
        paidCount: earned.length,
        lifetimeCents: earned.reduce((sum, o) => sum + (o.totalCents || 0), 0),
        currency: last?.currency ?? "INR",
        last: last ? {
          id: last.id, totalCents: last.totalCents, status: last.status,
          createdAt: last.createdAt, summary: last.items?.map(i => i.name).slice(0, 2).join(", ") || null,
        } : null,
      },
      pipeline: { stageId, stageName, stages },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST /api/inbox/contact — the CRM edits an agent makes mid-conversation.
// Body: { conversationId? | phone?, action: "tags", tags: string[] }
//       { …, action: "note", note: string }
//       { …, action: "stage", stageId: string | null }
export async function POST(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await guardFeature(tenantId, "extension"); if (gate) return gate;
  let body: { conversationId?: string; phone?: string; action?: string; tags?: string[]; note?: string; stageId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const contact = await resolveContact(tenantId, body.conversationId ?? null, body.phone ?? null);
    if (!contact) return NextResponse.json({ error: "No contact record for this chat yet" }, { status: 404 });

    if (body.action === "tags") {
      const tags = Array.from(new Set((body.tags ?? []).map(t => t.trim()).filter(Boolean))).slice(0, 30);
      await updateContactProfile(contact.phone, { tags }, tenantId);
      return NextResponse.json({ success: true, tags });
    }

    if (body.action === "note") {
      // Kept as a contact attribute so it also shows on the portal's profile.
      const note = (body.note ?? "").slice(0, 2000);
      await updateContactProfile(contact.phone, { attributes: { ...contact.attributes, note } }, tenantId);
      return NextResponse.json({ success: true, note });
    }

    if (body.action === "stage") {
      const stageId = body.stageId || null;
      await moveContact(contact.id, stageId, tenantId);
      // Auto-tag / auto-enrol / CRM stage push — same side effects as the portal.
      if (stageId) after(() => applyStageEffects(contact.id, stageId, tenantId).catch(() => undefined));
      const stage = stageId ? (await listStages(tenantId)).find(s => s.id === stageId) : null;
      return NextResponse.json({ success: true, stageId, stageName: stage?.name ?? null });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
