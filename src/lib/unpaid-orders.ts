// One reminder for an order left unpaid, with the same pay link the customer
// was given at checkout. Off until the workspace turns it on (Today → Settings),
// because it messages customers.
//
// Rules, each checked at send time:
//  - once per order: unpaid_reminded_at is claimed before sending
//  - only inside WhatsApp's 24-hour window (a plain message; no template), and
//    only for orders from the last 20 hours, so the window is still plausible
//  - never to someone who opted out, and only when the account may send
//  - only when the order still has its pay link (orders from before the link
//    was saved are left alone)
// The reminder shows in the customer's chat like every other message.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { appendConvMessage, isOptedOutStrict } from "./store";
import { listChannels, isLiveChannel } from "./channels";
import { sendText } from "./whatsapp";
import { accountCanSend } from "./feature-guard";
import { normalizeWorkSettings, WORK_SETTINGS_KEY } from "./work-settings";

export function unpaidMessage(o: { name?: string | null; shortId: string; amount: string; url: string }): string {
  const hi = o.name?.trim() ? `Hi ${o.name.trim().split(/\s+/)[0]}, your` : "Your";
  return `${hi} order ${o.shortId} for ${o.amount} is still waiting for payment. You can pay here: ${o.url}\n\nReply here if you have any questions.`;
}

function money(cents: number, currency = "INR"): string {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100); }
  catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
}

export async function drainUnpaidReminders(now = Date.now(), max = 50): Promise<{ sent: number; skipped: number }> {
  const { data: settings } = await db().from("wa_settings").select("tenant_id,value").eq("key", WORK_SETTINGS_KEY).limit(500);
  let sent = 0, skipped = 0;
  for (const s of (settings ?? []) as { tenant_id: string; value: unknown }[]) {
    const cfg = normalizeWorkSettings(s.value).unpaidReminder;
    if (!cfg.enabled) continue;
    const tenantId = s.tenant_id;
    const { data: orders, error } = await db().from("wa_orders").select("id,phone,total_cents,currency,payment_url,created_at")
      .eq("tenant_id", tenantId).eq("status", "pending").is("unpaid_reminded_at", null).not("payment_url", "is", null)
      .lte("created_at", new Date(now - cfg.afterMinutes * 60_000).toISOString())
      .gte("created_at", new Date(now - 20 * 3_600_000).toISOString())
      .order("created_at", { ascending: true }).limit(max);
    if (error || !orders?.length) continue;
    if (!(await accountCanSend(tenantId).catch(() => false))) continue;
    const channels = (await listChannels(tenantId)).filter(c => c.kind === "whatsapp" && isLiveChannel(c));
    if (!channels.length) continue;

    for (const o of orders as { id: string; phone: string; total_cents: number; currency: string; payment_url: string; created_at: string }[]) {
      // Claim first: a second run (or a retry) finds it already taken.
      const { data: claimed } = await db().from("wa_orders").update({ unpaid_reminded_at: new Date(now).toISOString() })
        .eq("tenant_id", tenantId).eq("id", o.id).is("unpaid_reminded_at", null).select("id");
      if (!claimed?.length) continue;
      if (await isOptedOutStrict(o.phone, tenantId).catch(() => true)) { skipped++; continue; }
      const { data: conv } = await tdb(tenantId).from("wa_conversations").select("id,name,channel_id,last_inbound_at").eq("phone", o.phone).eq("platform", "whatsapp").maybeSingle();
      const chat = conv as unknown as { id: string; name: string | null; channel_id: string | null; last_inbound_at: string | null } | null;
      if (!chat?.last_inbound_at || now - Date.parse(chat.last_inbound_at) >= 24 * 3_600_000) { skipped++; continue; }
      const channel = channels.find(c => c.id === chat.channel_id) ?? channels.find(c => c.isDefault) ?? channels[0];
      const body = unpaidMessage({ name: chat.name, shortId: o.id.slice(0, 8), amount: money(o.total_cents, o.currency), url: o.payment_url });
      const r = await sendText(o.phone, body, channel).catch(e => ({ id: undefined, error: e instanceof Error ? e.message : "send failed" }));
      if (!r.id) { skipped++; console.error("[unpaid-orders] send", tenantId, o.id, r.error); continue; }
      sent++;
      await appendConvMessage({ conversationId: chat.id, role: "assistant", body, metaId: r.id, source: "bot", tenantId, channelId: channel.id ?? chat.channel_id })
        .catch(e => console.error("[unpaid-orders] chat log", tenantId, e));
    }
  }
  return { sent, skipped };
}
