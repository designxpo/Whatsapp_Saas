// The read-only tools behind "Ask your data" (askdata.ts).
//
// The model never writes a query. It chooses one of these tools and fills in
// its arguments; runTool() validates them and runs a fixed count. That is the
// whole safety argument, so it is worth stating what it rules out:
//
//   • no write of any kind — every tool is a select or a head count;
//   • no free-form SQL or column names — filters are a closed set, and values
//     only ever reach PostgREST as parameters;
//   • no other workspace's rows — every query carries an explicit tenant filter,
//     because db() is the service client;
//   • no silent truncation — counts are head-only, and the one tool that needs
//     rows (lead_breakdown) pages (pagedselect.ts).
//
// Each result carries a plain-English description of exactly what was
// counted, shown under the answer as "How I counted" — a number the reader can
// check is worth more than a confident one.
//
// Dates are business days in India (businessclock.ts), YYYY-MM-DD, with the
// end date INCLUDED: "14 to 21 October" means both of those days.

import { db } from "./supabase";
import { pageAll } from "./pagedselect";
import { listChannels } from "./channels";
import { instantAt, addDaysIn } from "./businessclock";
import type { ChatTool } from "./ai/chat";

export type ToolResult =
  | { ok: true; result: Record<string, unknown>; description: string }
  | { ok: false; error: string };

// ChatTool takes flat string parameters (ai/chat.ts — the same shape on every
// provider), so the allowed values are spelled out in each description and
// validated in runTool.
const DATE = (what: string) => ({ name: what, description: `${what === "from" ? "First" : "Last"} day, YYYY-MM-DD (India time). Inclusive.` });
const NUMBER_ARG = { name: "number", description: "The WhatsApp number / account by its name in the portal. Use list_numbers to see the names." };

export const ASK_TOOLS: ChatTool[] = [
  {
    name: "list_numbers",
    description: "The workspace's numbers and accounts (WhatsApp, Instagram, Messenger, website chat), by name.",
    params: [], required: [],
  },
  {
    name: "count_leads",
    description: "How many leads (contacts) were created between two dates, optionally only those matching a source, city or course/product.",
    params: [
      DATE("from"), DATE("to"),
      { name: "source", description: "Text the lead's source contains, e.g. \"whatsapp\", \"Website\"." },
      { name: "city", description: "Text the lead's city contains." },
      { name: "course", description: "Text the course / product (Product Name) contains." },
    ],
    required: ["from", "to"],
  },
  {
    name: "lead_breakdown",
    description: "Leads created between two dates, grouped by source, city or course, largest group first.",
    params: [DATE("from"), DATE("to"), { name: "by", description: "One of: source, city, course." }],
    required: ["from", "to", "by"],
  },
  {
    name: "count_conversations",
    description: "How many conversations there are right now, optionally only those waiting on our reply, with a status, on a channel, or owned by a number.",
    params: [
      { name: "waiting", description: "\"yes\" to count only conversations waiting on our reply." },
      { name: "status", description: "One of: active, escalated." },
      { name: "platform", description: "One of: whatsapp, instagram, messenger, webchat." },
      NUMBER_ARG,
    ],
    required: [],
  },
  {
    name: "count_messages",
    description: "How many messages were sent between two dates: from leads, AI replies, or replies by the team.",
    params: [{ name: "kind", description: "One of: from_leads, ai_replies, from_team." }, DATE("from"), DATE("to"), NUMBER_ARG],
    required: ["kind", "from", "to"],
  },
  {
    name: "broadcast_stats",
    description: "Broadcast (template) sends between two dates: how many were sent, delivered, read and failed.",
    params: [DATE("from"), DATE("to")], required: ["from", "to"],
  },
  {
    name: "drip_stats",
    description: "People in drip sequences by status (active, completed, stopped), optionally for one sequence by name.",
    params: [{ name: "sequence", description: "Text the sequence name contains." }], required: [],
  },
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SPAN_DAYS = 400;

/** IST business days → [from, to) as ISO instants, the end day included. */
export function dayRange(from: unknown, to: unknown): { ok: true; from: string; to: string; label: string } | { ok: false; error: string } {
  const a = typeof from === "string" ? DATE_RE.exec(from.trim()) : null;
  const b = typeof to === "string" ? DATE_RE.exec(to.trim()) : null;
  if (!a || !b) return { ok: false, error: "Dates must be YYYY-MM-DD." };
  const start = instantAt({ year: +a[1], month: +a[2], day: +a[3] });
  const lastDay = instantAt({ year: +b[1], month: +b[2], day: +b[3] });
  if (isNaN(start.getTime()) || isNaN(lastDay.getTime())) return { ok: false, error: "Those are not real dates." };
  if (lastDay < start) return { ok: false, error: "The end date is before the start date." };
  if ((lastDay.getTime() - start.getTime()) / 86_400_000 > MAX_SPAN_DAYS) return { ok: false, error: `Ask about ${MAX_SPAN_DAYS} days or fewer at a time.` };
  const end = addDaysIn(lastDay, 1);
  return { ok: true, from: start.toISOString(), to: end.toISOString(), label: from === to ? `on ${from}` : `${from} to ${to}` };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
// ilike treats % and _ as wildcards; a value is matched as literal text.
const like = (v: string) => `%${v.replace(/[\\%_]/g, m => `\\${m}`)}%`;
// PostgREST's or() is a comma/paren grammar; a value carrying those would break
// out of it. The source filter is the only one that needs or().
const orSafe = (v: string) => v.replace(/[,()"]/g, " ").trim();

async function numberId(tenantId: string, name: unknown): Promise<{ ok: true; id: string | null; label: string } | { ok: false; error: string }> {
  const n = str(name);
  if (!n) return { ok: true, id: null, label: "" };
  const channels = await listChannels(tenantId);
  const hit = channels.find(c => (c.name ?? "").trim().toLowerCase() === n.toLowerCase());
  if (!hit) return { ok: false, error: `No number called "${n}". The numbers are: ${channels.map(c => c.name).filter(Boolean).join(", ")}.` };
  return { ok: true, id: hit.id, label: ` on ${hit.name}` };
}

type Filter = ["eq" | "gte" | "lt" | "ilike" | "or" | "in", ...unknown[]];

async function headCount(table: string, tenantId: string, filters: Filter[]): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
  for (const [op, a, b] of filters) {
    if (op === "eq") q = q.eq(a as string, b);
    else if (op === "gte") q = q.gte(a as string, b);
    else if (op === "lt") q = q.lt(a as string, b);
    else if (op === "ilike") q = q.ilike(a as string, b as string);
    else if (op === "in") q = q.in(a as string, b as unknown[]);
    else q = q.or(a as string);
  }
  const { count, error } = await q;
  if (error) throw new Error((error as { message?: string }).message || `could not count ${table}`);
  return count ?? 0;
}

const MESSAGE_KINDS: Record<string, { filters: Filter[]; label: string }> = {
  from_leads: { filters: [["eq", "role", "user"]], label: "messages from leads" },
  ai_replies: { filters: [["eq", "role", "assistant"], ["eq", "source", "bot"]], label: "AI replies" },
  from_team: { filters: [["eq", "role", "assistant"], ["eq", "source", "agent"]], label: "replies by the team" },
};

const BREAKDOWN: Record<string, (r: { source: string | null; attributes: Record<string, string> | null }) => string | null> = {
  source: r => r.source || r.attributes?.lsq_source || null,
  city: r => r.attributes?.city || null,
  course: r => r.attributes?.["Product Name"] || null,
};

export async function runTool(name: string, args: Record<string, unknown>, tenantId: string): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_numbers": {
        const channels = await listChannels(tenantId);
        return { ok: true, result: { numbers: channels.map(c => ({ name: c.name, kind: c.kind ?? "whatsapp", active: c.active })) }, description: "Listed the workspace's numbers" };
      }

      case "count_leads": {
        const r = dayRange(args.from, args.to);
        if (!r.ok) return r;
        const filters: Filter[] = [["gte", "created_at", r.from], ["lt", "created_at", r.to]];
        const parts: string[] = [];
        const source = str(args.source), city = str(args.city), course = str(args.course);
        if (source) { const v = orSafe(source); filters.push(["or", `source.ilike.${like(v)},attributes->>lsq_source.ilike.${like(v)}`]); parts.push(`source contains "${v}"`); }
        if (city) { filters.push(["ilike", "attributes->>city", like(city)]); parts.push(`city contains "${city}"`); }
        if (course) { filters.push(["ilike", "attributes->>Product Name", like(course)]); parts.push(`course contains "${course}"`); }
        const count = await headCount("contacts", tenantId, filters);
        return { ok: true, result: { count }, description: `Leads created ${r.label}${parts.length ? `, ${parts.join(", ")}` : ""}: ${count}` };
      }

      case "lead_breakdown": {
        const r = dayRange(args.from, args.to);
        if (!r.ok) return r;
        const by = typeof args.by === "string" ? BREAKDOWN[args.by] : undefined;
        if (!by) return { ok: false, error: "by must be source, city or course." };
        const tid = tenantId;
        const rows = await pageAll<{ source: string | null; attributes: Record<string, string> | null }>(
          () => db().from("contacts").select("source, attributes").eq("tenant_id", tid).gte("created_at", r.from).lt("created_at", r.to).order("id"),
          { label: "askdata:breakdown" },
        );
        const groups = new Map<string, number>();
        for (const row of rows) { const v = by(row) ?? "Unknown"; groups.set(v, (groups.get(v) ?? 0) + 1); }
        const top = [...groups].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 15);
        return { ok: true, result: { total: rows.length, groups: top }, description: `Leads created ${r.label}, grouped by ${args.by}: ${rows.length} in ${groups.size} groups` };
      }

      case "count_conversations": {
        const filters: Filter[] = [];
        const parts: string[] = [];
        if (args.waiting === true || (typeof args.waiting === "string" && /^(yes|true)$/i.test(args.waiting.trim()))) { filters.push(["eq", "needs_reply", true]); parts.push("waiting on our reply"); }
        if (args.status !== undefined) {
          if (args.status !== "active" && args.status !== "escalated") return { ok: false, error: "status must be active or escalated." };
          filters.push(["eq", "status", args.status]); parts.push(args.status as string);
        }
        if (args.platform !== undefined) {
          if (!["whatsapp", "instagram", "messenger", "webchat"].includes(args.platform as string)) return { ok: false, error: "platform must be whatsapp, instagram, messenger or webchat." };
          filters.push(["eq", "platform", args.platform]); parts.push(`on ${args.platform}`);
        }
        const num = await numberId(tenantId, args.number);
        if (!num.ok) return num;
        if (num.id) filters.push(["eq", "channel_id", num.id]);
        const count = await headCount("wa_conversations", tenantId, filters);
        return { ok: true, result: { count }, description: `Conversations${parts.length ? ` ${parts.join(", ")}` : ""}${num.label}, right now: ${count}` };
      }

      case "count_messages": {
        const kind = typeof args.kind === "string" ? MESSAGE_KINDS[args.kind] : undefined;
        if (!kind) return { ok: false, error: "kind must be from_leads, ai_replies or from_team." };
        const r = dayRange(args.from, args.to);
        if (!r.ok) return r;
        const num = await numberId(tenantId, args.number);
        if (!num.ok) return num;
        const filters: Filter[] = [...kind.filters, ["gte", "created_at", r.from], ["lt", "created_at", r.to]];
        if (num.id) filters.push(["eq", "channel_id", num.id]);
        const count = await headCount("wa_conv_messages", tenantId, filters);
        return { ok: true, result: { count }, description: `${kind.label[0].toUpperCase()}${kind.label.slice(1)} ${r.label}${num.label}: ${count}` };
      }

      case "broadcast_stats": {
        const r = dayRange(args.from, args.to);
        if (!r.ok) return r;
        const range: Filter[] = [["gte", "sent_at", r.from], ["lt", "sent_at", r.to]];
        // Statuses move forward — a read message was delivered and sent first —
        // so each figure counts its status and every later one.
        const [sent, delivered, read, failed] = await Promise.all([
          headCount("wa_send_log", tenantId, [...range, ["in", "status", ["sent", "delivered", "read"]]]),
          headCount("wa_send_log", tenantId, [...range, ["in", "status", ["delivered", "read"]]]),
          headCount("wa_send_log", tenantId, [...range, ["eq", "status", "read"]]),
          headCount("wa_send_log", tenantId, [...range, ["eq", "status", "failed"]]),
        ]);
        return { ok: true, result: { sent, delivered, read, failed }, description: `Broadcast sends ${r.label}: ${sent} sent, ${delivered} delivered, ${read} read, ${failed} failed` };
      }

      case "drip_stats": {
        const tid = tenantId;
        const name = str(args.sequence);
        let seqQ = db().from("wa_sequences").select("id, name").eq("tenant_id", tid);
        if (name) seqQ = seqQ.ilike("name", like(name));
        const { data: seqs, error } = await seqQ;
        if (error) throw new Error(error.message);
        if (!seqs?.length) return { ok: false, error: name ? `No drip sequence matches "${name}".` : "There are no drip sequences." };
        const ids = seqs.map(s => s.id as string);
        const [active, completed, stopped] = await Promise.all(["active", "completed", "stopped"].map(st =>
          headCount("wa_sequence_enrollments", tenantId, [["in", "sequence_id", ids], ["eq", "status", st]])));
        const which = name ? seqs.map(s => s.name).join(", ") : "all sequences";
        return { ok: true, result: { active, completed, stopped, sequences: seqs.map(s => s.name) }, description: `People in drips (${which}): ${active} active, ${completed} completed, ${stopped} stopped` };
      }

      default:
        return { ok: false, error: `There is no tool called ${name}.` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The count failed." };
  }
}
