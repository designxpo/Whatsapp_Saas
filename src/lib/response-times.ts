// How fast customers get an answer — measured from the messages themselves.
//
// A "wait" starts at a customer message that arrives when nothing is pending
// and ends at the next message we send (AI or a person). Follow-up customer
// messages inside the same wait don't restart the clock: the customer has
// been waiting since their first one. Waits still open aren't counted here;
// Today shows those as live items.
//
// The log records whether a reply came from the AI or a person, not which
// person, so there is no per-teammate figure yet.

import { db } from "./supabase";

export interface ResponseTimes {
  days: number;
  answered: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
  withinTargetPct: number | null;
  /** Waits a person (not the AI) closed, and how long those took. */
  byPeople: { answered: number; medianMinutes: number | null };
  /** True when the sample hit its size cap, so figures cover only part of the period. */
  partial: boolean;
}

type Msg = { conversation_id: string; role: "user" | "assistant"; source: string; created_at: string };

const MAX_MSGS = 20_000;

export function measureWaits(msgs: Msg[]): { minutes: number; byPerson: boolean }[] {
  const byConv = new Map<string, Msg[]>();
  for (const m of msgs) byConv.set(m.conversation_id, [...(byConv.get(m.conversation_id) ?? []), m]);
  const out: { minutes: number; byPerson: boolean }[] = [];
  for (const list of byConv.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let waitingSince: string | null = null;
    for (const m of list) {
      if (m.role === "user") { waitingSince ??= m.created_at; continue; }
      if (waitingSince) {
        out.push({ minutes: (Date.parse(m.created_at) - Date.parse(waitingSince)) / 60_000, byPerson: m.source === "agent" });
        waitingSince = null;
      }
    }
  }
  return out;
}

const pct = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : null;
const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export async function responseTimes(tenantId: string, opts: { channelIds: string[] | null; targetMinutes: number; days?: number; now?: number }): Promise<ResponseTimes> {
  const days = opts.days ?? 7;
  const empty: ResponseTimes = { days, answered: 0, medianMinutes: null, p90Minutes: null, withinTargetPct: null, byPeople: { answered: 0, medianMinutes: null }, partial: false };
  if (opts.channelIds && opts.channelIds.length === 0) return empty;
  const since = new Date((opts.now ?? Date.now()) - days * 86_400_000).toISOString();
  let q = db().from("wa_conv_messages").select("conversation_id,role,source,created_at").eq("tenant_id", tenantId).gte("created_at", since);
  if (opts.channelIds) q = q.in("channel_id", opts.channelIds);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(MAX_MSGS);
  if (error || !data?.length) return empty;
  const waits = measureWaits(data as unknown as Msg[]);
  if (!waits.length) return { ...empty, partial: data.length >= MAX_MSGS };
  const all = waits.map(w => w.minutes).sort((a, b) => a - b);
  const people = waits.filter(w => w.byPerson).map(w => w.minutes).sort((a, b) => a - b);
  return {
    days, answered: all.length,
    medianMinutes: round(pct(all, 0.5)), p90Minutes: round(pct(all, 0.9)),
    withinTargetPct: Math.round(100 * all.filter(m => m <= opts.targetMinutes).length / all.length),
    byPeople: { answered: people.length, medianMinutes: round(pct(people, 0.5)) },
    partial: data.length >= MAX_MSGS,
  };
}
