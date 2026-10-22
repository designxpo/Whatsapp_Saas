// The figures in the daily digest (dailydigest.ts), for one workspace.
//
// Same definitions as Analytics, so the email and the dashboard agree: waiting
// is needs_reply, an AI reply is a wa_conv_messages row with source "bot" —
// less the delivery-failure notes, which are source "bot" too (weeklyrecap.ts).
//
// Counts are head-only queries — PostgREST caps a row response at 1,000 and
// says nothing, so a count read off returned rows would stop at 1,000 waiting
// chats exactly when the backlog matters. The per-number split needs the rows,
// so it pages (pagedselect.ts).

import { db } from "./supabase";
import { pageAll } from "./pagedselect";
import { listChannels } from "./channels";
import { SEND_FAILURE_PREFIX } from "./store";
import { startOfDayIn, addDaysIn, partsIn } from "./businessclock";

export interface DigestNumbers {
  /** The business day "yesterday" refers to, YYYY-MM-DD. */
  day: string;
  waiting: { total: number; oldestHours: number | null; byOwner: { name: string; count: number }[] };
  escalatedStale: number;
  yesterday: { newLeads: number; aiReplies: number; escalations: number; optOuts: number; failedSends: number };
  inDrips: number;
}

type Filter = ["eq" | "gte" | "lt" | "notlike", string, string | boolean];

async function count(table: string, tenantId: string, filters: Filter[]): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);   // "*": wa_optouts has no id
  for (const [op, col, val] of filters) {
    q = op === "eq" ? q.eq(col, val) : op === "gte" ? q.gte(col, val) : op === "lt" ? q.lt(col, val) : q.not(col, "like", `${val}%`);
  }
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
}

// db() is the service client here, so `tenantId` is applied to every query.
export async function gatherDigest(tenantId: string, now = Date.now()): Promise<DigestNumbers> {
  const today = startOfDayIn(new Date(now));
  const yesterday = addDaysIn(today, -1);
  const from = yesterday.toISOString(), to = today.toISOString();
  const w = partsIn(yesterday);
  const day = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  const dayAgo = new Date(now - 86_400_000).toISOString();

  const [waitingRows, channels, total, escalatedStale, newLeads, aiReplies, escalations, optOuts, failedSends, inDrips] = await Promise.all([
    pageAll<{ channel_id: string | null; last_inbound_at: string | null }>(
      () => db().from("wa_conversations").select("channel_id, last_inbound_at").eq("tenant_id", tenantId).eq("needs_reply", true).order("id"),
      { label: "digest:waiting" },
    ),
    listChannels(tenantId).catch(() => []),
    count("wa_conversations", tenantId, [["eq", "needs_reply", true]]),
    count("wa_conversations", tenantId, [["eq", "status", "escalated"], ["lt", "escalated_at", dayAgo]]),
    count("contacts", tenantId, [["gte", "created_at", from], ["lt", "created_at", to]]),
    count("wa_conv_messages", tenantId, [["eq", "source", "bot"], ["notlike", "body", SEND_FAILURE_PREFIX], ["gte", "created_at", from], ["lt", "created_at", to]]),
    count("wa_conversations", tenantId, [["gte", "escalated_at", from], ["lt", "escalated_at", to]]),
    count("wa_optouts", tenantId, [["gte", "created_at", from], ["lt", "created_at", to]]),
    count("wa_send_log", tenantId, [["eq", "status", "failed"], ["gte", "sent_at", from], ["lt", "sent_at", to]]),
    count("wa_sequence_enrollments", tenantId, [["eq", "status", "active"]]),
  ]);

  const names = new Map(channels.map(c => [c.id, c.name]));
  const byOwner = new Map<string, number>();
  let oldest: number | null = null;
  for (const r of waitingRows) {
    const name = (r.channel_id && names.get(r.channel_id)) || "No number assigned";
    byOwner.set(name, (byOwner.get(name) ?? 0) + 1);
    const t = r.last_inbound_at ? Date.parse(r.last_inbound_at) : NaN;
    if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
  }

  return {
    day,
    waiting: {
      total,
      oldestHours: oldest === null ? null : Math.max(0, Math.round((now - oldest) / 3_600_000)),
      byOwner: [...byOwner].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count).slice(0, 8),
    },
    escalatedStale,
    yesterday: { newLeads, aiReplies, escalations, optOuts, failedSends },
    inDrips,
  };
}
