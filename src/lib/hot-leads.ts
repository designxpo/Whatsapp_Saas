// Hot leads — who to call first, worked out from the conversations themselves.
//
// No AI call and no new data: each chat from the last three days is scored on
// what the customer actually wrote and did, and every score comes with its
// reasons in plain words, so the owner can see why someone is on the list:
//  - buying signals in their own messages (price, booking, ordering, details —
//    in English and Hinglish), one group at a time so repetition can't inflate it;
//  - how recently they wrote, how engaged they are, whether they shared a
//    number and are waiting on a reply;
//  - lowered for someone who has just paid (already a customer) or who sounds
//    unhappy (a different conversation, not a sales call).
//
// Once the AI has read a chat (lead-intel.ts), its read is used instead: its
// status picks the band, its score and reason are shown, and "ready to pay"
// goes first among the reasons. Chats it hasn't read keep the rules above.

import { tdb } from "./tenantdb";
import { bandOf } from "./lead-intel";

export interface LeadInput {
  inbound: string[];            // their messages, newest last
  lastInboundAt: string | null;
  sharedPhone: boolean;
  waitingOnReply: boolean;
  paidRecently: boolean;
}
export interface LeadScore { score: number; band: "hot" | "warm" | "cold"; reasons: string[] }

const SIGNALS: { label: string; re: RegExp }[] = [
  { label: "asked about price", re: /\b(price|prices|pricing|cost|fees?|rate|rates|charges?|kitna|kitne|kitni|how much|quote|discount|offer|emi)\b/i },
  { label: "wants to book or join", re: /\b(book|booking|appointment|slot|demo|visit|admission|enrol+|join|register|registration)\b/i },
  { label: "ready to buy", re: /\b(buy|purchase|order|available|availability|in stock|delivery|deliver|cod|payment|pay|upi)\b/i },
  { label: "asked for details", re: /\b(interested|details|brochure|more info|information|send me|share)\b/i },
];
const UNHAPPY = /\b(complaint|refund|worst|useless|cheat|fraud|scam|angry|bad service|not happy|disappointed)\b/i;
const HOUR = 3_600_000;

/** Score one conversation. Pure. */
export function scoreLead(l: LeadInput, now = Date.now()): LeadScore {
  const text = l.inbound.join("\n");
  const reasons: string[] = [];
  let score = 0;
  for (const s of SIGNALS) if (s.re.test(text)) { score += 25; reasons.push(s.label); }
  const ageH = l.lastInboundAt ? (now - Date.parse(l.lastInboundAt)) / HOUR : Infinity;
  if (ageH < 6) { score += 20; reasons.push("wrote in the last few hours"); }
  else if (ageH < 24) { score += 12; reasons.push("wrote today"); }
  else if (ageH < 72) score += 5;
  if (l.inbound.length >= 6) { score += 12; reasons.push(`${l.inbound.length} messages`); }
  else if (l.inbound.length >= 3) score += 8;
  if (l.sharedPhone) { score += 8; reasons.push("shared a phone number"); }
  if (l.waitingOnReply) { score += 10; reasons.push("waiting on your reply"); }
  if (l.paidRecently) { score -= 40; reasons.push("already paid this week"); }
  if (UNHAPPY.test(text)) { score -= 30; reasons.push("sounds unhappy — handle with care"); }
  const s = Math.max(0, Math.min(100, score));
  return { score: s, band: s >= 55 ? "hot" : s >= 30 ? "warm" : "cold", reasons };
}

export interface HotLead extends LeadScore { conversationId: string; name: string; phone: string; platform: string; lastInboundAt: string | null; lastMessage: string }

/**
 * The last three days' conversations, scored, best first. Bounded: the 300 most
 * recently active conversations and up to 30 of each one's messages.
 */
export async function hotLeads(tenantId: string, now = Date.now()): Promise<HotLead[]> {
  const since = new Date(now - 72 * HOUR).toISOString();
  const base = "id,phone,name,handle,platform,last_inbound_at,lead_phone,needs_reply,status";
  const pick = (cols: string) => tdb(tenantId).from("wa_conversations").select(cols)
    .gte("last_inbound_at", since).order("last_inbound_at", { ascending: false }).limit(300);
  let res = await pick(`${base},lead_status,intent_score,lead_reason,ready_to_pay`);
  if (res.error) res = await pick(base);   // before migration 20261103120000
  const list = (res.data ?? []) as unknown as { id: string; phone: string; name: string | null; handle: string | null; platform: string; last_inbound_at: string | null; lead_phone: string | null; needs_reply: boolean | null; status: string | null; lead_status?: string | null; intent_score?: number | null; lead_reason?: string | null; ready_to_pay?: boolean | null }[];
  if (!list.length) return [];

  const inbound = new Map<string, string[]>();
  for (let i = 0; i < list.length; i += 100) {
    const { data } = await tdb(tenantId).from("wa_conv_messages").select("conversation_id,body,created_at")
      .in("conversation_id", list.slice(i, i + 100).map(c => c.id)).eq("role", "user").gte("created_at", since)
      .order("created_at", { ascending: true }).limit(3000);
    for (const m of (data ?? []) as unknown as { conversation_id: string; body: string }[]) {
      const arr = inbound.get(m.conversation_id) ?? [];
      if (arr.length < 30) arr.push((m.body ?? "").replace(/^\[comment\]\s*/, ""));
      inbound.set(m.conversation_id, arr);
    }
  }
  const weekAgo = new Date(now - 7 * 24 * HOUR).toISOString();
  const { data: orders } = await tdb(tenantId).from("wa_orders").select("phone")
    .in("status", ["paid", "fulfilled"]).gte("created_at", weekAgo).in("phone", [...new Set(list.map(c => c.phone))].slice(0, 300));
  const paid = new Set(((orders ?? []) as unknown as { phone: string }[]).map(o => o.phone));

  return list
    .filter(c => c.status !== "opted_out")
    .map(c => {
      const msgs = inbound.get(c.id) ?? [];
      const ai = bandOf(c.lead_status);
      const s: LeadScore = ai
        ? { score: c.intent_score ?? 0, band: ai, reasons: [...(c.ready_to_pay ? ["ready to pay"] : []), ...(c.lead_reason ? [c.lead_reason] : [])] }
        : scoreLead({ inbound: msgs, lastInboundAt: c.last_inbound_at, sharedPhone: !!c.lead_phone, waitingOnReply: !!c.needs_reply, paidRecently: paid.has(c.phone) }, now);
      return { ...s, conversationId: c.id, name: c.name || c.handle || "", phone: c.phone, platform: c.platform, lastInboundAt: c.last_inbound_at, lastMessage: (msgs[msgs.length - 1] ?? "").slice(0, 160) };
    })
    .filter(l => l.band !== "cold")
    .sort((a, b) => b.score - a.score || (b.lastInboundAt ?? "").localeCompare(a.lastInboundAt ?? ""));
}
