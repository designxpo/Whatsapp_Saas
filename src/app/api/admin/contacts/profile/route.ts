import { NextResponse } from "next/server";
import { requireAdmin, currentUser, currentTenantId } from "@/lib/auth";
import { getContactByPhone, updateContactProfile } from "@/lib/store";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?phone= — the full lead profile: contact, conversation summary, recent
// messages, campaign/send history with receipts, and tracked-link clicks.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const digits = (new URL(req.url).searchParams.get("phone") ?? "").replace(/\D/g, "");
  if (!digits) return NextResponse.json({ error: "phone required" }, { status: 400 });

  // EVERY conversation this number appears on — the phone slot (WhatsApp) or the
  // captured lead_phone (web chat / Instagram / Messenger). Fetched first so
  // Instagram chats — which have NO contact row (keyed by IGSID, see
  // store.getOrCreateConversation) — can still render a profile instead of a 404
  // that spins the drawer forever. All of them together are the lead's journey:
  // a returning lead reads as one person, not one stranger per channel.
  const { data: convRows } = await db().from("wa_conversations")
    .select("id, status, bot_enabled, assigned_to, labels, agent_id, last_inbound_at, last_outbound_at, name, platform, lead_phone, created_at")
    .eq("tenant_id", tid).or(`phone.eq.${digits},lead_phone.eq.${digits}`).order("created_at", { ascending: false }).limit(8);
  const convRow = (convRows ?? [])[0] ?? null;

  let contact = await getContactByPhone(digits, tid);
  if (!contact) {
    if (!convRow) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    // Synthesize a minimal contact from the (Instagram) conversation.
    contact = {
      id: convRow.id as string,
      phone: digits,
      name: (convRow.name as string) ?? "",
      email: null,
      tags: [],
      attributes: convRow.lead_phone ? { lead_phone: convRow.lead_phone as string } : {},
      status: "active",
      channelId: null,
      source: (convRow.platform as string) ?? null,
      createdAt: (convRow.created_at as string) ?? new Date().toISOString(),
    };
  }

  // Messages + counts merged across every conversation, each tagged with its
  // channel so the drawer can label where a bubble happened.
  let messages: { role: string; body: string; source: string; platform: string; createdAt: string }[] = [];
  let msgCounts = { inbound: 0, outbound: 0 };
  if (convRow) {
    const ids = (convRows ?? []).map(r => r.id as string);
    const platformOf = new Map((convRows ?? []).map(r => [r.id as string, ((r.platform as string) || "whatsapp")]));
    const [{ data: msgs }, inb, outb] = await Promise.all([
      db().from("wa_conv_messages").select("conversation_id, role, body, source, created_at").eq("tenant_id", tid).in("conversation_id", ids).order("created_at", { ascending: false }).limit(12),
      db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("tenant_id", tid).in("conversation_id", ids).eq("role", "user"),
      db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("tenant_id", tid).in("conversation_id", ids).eq("role", "assistant"),
    ]);
    messages = (msgs ?? []).reverse().map(m => ({ role: m.role as string, body: m.body as string, source: (m.source as string) ?? "", platform: platformOf.get(m.conversation_id as string) ?? "whatsapp", createdAt: m.created_at as string }));
    msgCounts = { inbound: inb.count ?? 0, outbound: outb.count ?? 0 };
  }
  // The journey: one entry per channel conversation, oldest first (= first contact).
  const journey = [...(convRows ?? [])].reverse().map(r => ({
    platform: ((r.platform as string) || "whatsapp"),
    name: ((r.name as string) || ""),
    status: r.status as string,
    startedAt: r.created_at as string,
    lastInboundAt: (r.last_inbound_at as string | null) ?? null,
    lastOutboundAt: (r.last_outbound_at as string | null) ?? null,
  }));

  // Campaign history with delivery receipts.
  const { data: logRows } = await db().from("wa_send_log")
    .select("campaign_id, status, sent_at").eq("tenant_id", tid).eq("phone", digits).order("sent_at", { ascending: false }).limit(15);
  const campaignIds = [...new Set((logRows ?? []).map(r => r.campaign_id as string).filter(Boolean))];
  const names = new Map<string, string>();
  if (campaignIds.length) {
    const { data: camps } = await db().from("wa_campaigns").select("id, name, template_name").eq("tenant_id", tid).in("id", campaignIds);
    for (const c of camps ?? []) names.set(c.id as string, (c.name as string) || (c.template_name as string));
  }
  const campaigns = (logRows ?? []).map(r => ({
    name: names.get(r.campaign_id as string) ?? "Campaign",
    status: r.status as string,
    sentAt: r.sent_at as string,
  }));

  // Tracked-link clicks (click-tracking templates).
  const { data: linkRows } = await db().from("wa_links")
    .select("target_url, clicks, first_clicked_at").eq("tenant_id", tid).eq("phone", digits).gt("clicks", 0).limit(10);
  const clicks = (linkRows ?? []).map(l => ({ url: l.target_url as string, clicks: l.clicks as number, at: l.first_clicked_at as string | null }));

  return NextResponse.json({
    contact,
    conversation: convRow ? {
      id: convRow.id as string,
      status: convRow.status as string,
      botEnabled: convRow.bot_enabled as boolean,
      assignedTo: (convRow.assigned_to as string | null) ?? null,
      labels: (convRow.labels as string[]) ?? [],
      lastInboundAt: (convRow.last_inbound_at as string | null) ?? null,
      lastOutboundAt: (convRow.last_outbound_at as string | null) ?? null,
    } : null,
    messages,
    msgCounts,
    journey,
    campaigns,
    clicks,
  });
}

// PATCH { phone, name?, email?, tags?, attributes? } — edit the lead in place.
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { phone?: string; name?: string; email?: string | null; tags?: string[]; attributes?: Record<string, string> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const digits = (body.phone ?? "").replace(/\D/g, "");
  if (!digits) return NextResponse.json({ error: "phone required" }, { status: 400 });
  await updateContactProfile(digits, { name: body.name, email: body.email, tags: body.tags, attributes: body.attributes }, tid);
  logActivity(await currentUser(), "contact.update", digits);
  return NextResponse.json({ success: true });
}
