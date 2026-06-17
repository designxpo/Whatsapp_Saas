import { NextResponse } from "next/server";
import { crmAuthorized } from "@/lib/crm";
import { getConversationByPhone } from "@/lib/store";
import { db } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// GET ?phone= — this lead's WhatsApp engagement: message counts, campaign
// receipts, links tapped, last touch, live status. For the CRM insights tab.
export async function GET(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const phone = (new URL(req.url).searchParams.get("phone") ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  try {
    const conv = await getConversationByPhone(phone);
    const tid = conv?.tenantId ?? DEFAULT_TENANT_ID;
    let msgCounts = { inbound: 0, outbound: 0 };
    let status: string | null = null, botEnabled = false;
    let lastInboundAt: string | null = null, lastOutboundAt: string | null = null;
    if (conv) {
      const [inb, outb] = await Promise.all([
        db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("tenant_id", tid).eq("conversation_id", conv.id).eq("role", "user"),
        db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("tenant_id", tid).eq("conversation_id", conv.id).eq("role", "assistant"),
      ]);
      msgCounts = { inbound: inb.count ?? 0, outbound: outb.count ?? 0 };
      status = conv.status; botEnabled = conv.botEnabled;
      lastInboundAt = conv.lastInboundAt; lastOutboundAt = conv.lastOutboundAt;
    }

    const { data: logRows } = await db().from("wa_send_log")
      .select("campaign_id, status, sent_at").eq("tenant_id", tid).eq("phone", phone).order("sent_at", { ascending: false }).limit(15);
    const campaignIds = [...new Set((logRows ?? []).map(r => r.campaign_id as string).filter(Boolean))];
    const names = new Map<string, string>();
    if (campaignIds.length) {
      const { data: camps } = await db().from("wa_campaigns").select("id, name, template_name").eq("tenant_id", tid).in("id", campaignIds);
      for (const c of camps ?? []) names.set(c.id as string, (c.name as string) || (c.template_name as string));
    }
    const campaigns = (logRows ?? []).map(r => ({ name: names.get(r.campaign_id as string) ?? "Campaign", status: r.status as string, sentAt: r.sent_at as string }));

    const { data: linkRows } = await db().from("wa_links")
      .select("target_url, clicks, first_clicked_at").eq("tenant_id", tid).eq("phone", phone).gt("clicks", 0).limit(10);
    const clicks = (linkRows ?? []).map(l => ({ url: l.target_url as string, clicks: l.clicks as number, at: l.first_clicked_at as string | null }));

    const windowOpen = !!lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
    return NextResponse.json({
      hasConversation: !!conv, msgCounts, campaigns, clicks,
      lastInboundAt, lastOutboundAt, status, botEnabled, window: windowOpen ? "open" : "closed",
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
