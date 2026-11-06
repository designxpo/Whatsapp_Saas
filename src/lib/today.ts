// Today — the work that needs a person, from every part of the product, in one
// list. Each item has a person (or "Unassigned"), a next action and a deadline,
// as the audit asked. Nothing here is new data: it reads what the inbox, sales
// closer, approvals, orders, tasks, review cases and social commitments already
// record, and puts a deadline on each.
//
// Scoping follows the inbox: a teammate limited to their team's numbers sees
// only those chats; orders are admin-only (as the Orders screen is).

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { isAiEnabled } from "./messaging-settings";
import { getWorkSettings, type WorkSettings } from "./work-settings";
import { UNANSWERED_AFTER_MS } from "./store";
import { listTasks, type WorkViewer } from "./tasks";
import { addDaysIn, startOfDayIn } from "./businessclock";
import { healthReport } from "./integration-health";
import { listBookings } from "./bookings";

export type TodayKind = "reply" | "ready_to_pay" | "approval" | "unpaid_order" | "task" | "review_case" | "commitment" | "connection" | "booking";

export interface TodayItem {
  key: string;
  kind: TodayKind;
  title: string;
  detail: string;
  /** Who should do it: a teammate's display name, or null when nobody owns it yet. */
  person: string | null;
  action: string;
  dueAt: string | null;
  overdue: boolean;
  mine: boolean;
  /** Where the item opens. */
  open: { tab: "livechat"; phone: string } | { tab: "reviews"; reviewId?: string } | { tab: "catalog" | "growth" | "today" | "integrations" | "setup" | "instagram" | "facebook" | "bookings" };
  taskId?: string;
}

export interface TodayResult {
  items: TodayItem[];
  settings: WorkSettings;
  counts: { overdue: number; dueToday: number; unassigned: number; mine: number };
  setupPending: boolean;
}

const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const missing = (e: { code?: string } | null | undefined) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");

const CHAT_COLS = "id,name,phone,last_message,last_inbound_at,status,bot_enabled,assigned_to,channel_id";
type ChatRow = { id: string; name: string | null; phone: string; last_message: string | null; last_inbound_at: string; status: string; bot_enabled: boolean | null; assigned_to: string | null; channel_id: string | null };

export async function buildToday(v: WorkViewer, myId: string | null, now: number = Date.now()): Promise<TodayResult> {
  const settings = await getWorkSettings(v.tenantId);
  const target = settings.replyTargetMinutes;
  const endOfDay = addDaysIn(startOfDayIn(new Date(now)), 1).toISOString();
  const me = { name: v.user.name, email: v.user.email };
  const isMe = (person: string | null) => same(person, me.name) || same(person, me.email);
  const scoped = <Q extends { in: (c: string, v: string[]) => Q }>(q: Q) => (v.allowed ? q.in("channel_id", v.allowed) : q);
  const items: TodayItem[] = [];
  let setupPending = false;

  if (v.allowed && v.allowed.length === 0) {
    // A teammate on a team with no numbers sees no chats, but still their own tasks.
  } else {
    // 1. Customers waiting for a person. With the AI on, the AI gets
    // UNANSWERED_AFTER_MS first; escalated or human-handled chats wait from the start.
    const aiOn = await isAiEnabled(v.tenantId).catch(() => true);
    const since = new Date(now - 24 * 3_600_000).toISOString();
    let q = db().from("wa_conversations").select(CHAT_COLS).eq("tenant_id", v.tenantId)
      .eq("needs_reply", true).in("status", ["active", "escalated"]).gte("last_inbound_at", since);
    q = scoped(q);
    if (aiOn) q = q.or(`status.eq.escalated,bot_enabled.eq.false,last_inbound_at.lte."${new Date(now - UNANSWERED_AFTER_MS).toISOString()}"`);
    const { data: waiting } = await q.order("last_inbound_at", { ascending: true }).limit(100);
    for (const c of (waiting ?? []) as unknown as ChatRow[]) {
      const due = plus(c.last_inbound_at, target);
      items.push({
        key: `reply:${c.id}`, kind: "reply", title: c.name || `+${c.phone}`,
        detail: (c.last_message ?? "").slice(0, 140) || "Sent a message",
        person: c.assigned_to, action: c.status === "escalated" ? "Reply — handed to the team" : "Reply",
        dueAt: due, overdue: Date.parse(due) <= now, mine: isMe(c.assigned_to),
        open: { tab: "livechat", phone: c.phone },
      });
    }

    // 2. Leads the AI read as ready to pay, and discounts/refunds waiting for approval.
    const seen = new Set(items.map(i => i.key));
    let ready = db().from("wa_conversations").select(`${CHAT_COLS},lead_scored_at`).eq("tenant_id", v.tenantId).eq("ready_to_pay", true).gte("lead_scored_at", since);
    ready = scoped(ready);
    const [r, a] = await Promise.all([
      ready.order("lead_scored_at", { ascending: true }).limit(50),
      db().from("wa_approval_requests").select("id,conversation_id,created_at,kind,percent,reason").eq("tenant_id", v.tenantId).eq("status", "pending").order("created_at", { ascending: true }).limit(50),
    ]);
    for (const c of ((r.error ? [] : r.data) ?? []) as unknown as (ChatRow & { lead_scored_at: string })[]) {
      if (seen.has(`reply:${c.id}`)) continue;
      const due = plus(c.lead_scored_at, target);
      items.push({
        key: `ready:${c.id}`, kind: "ready_to_pay", title: c.name || `+${c.phone}`, detail: "The AI read this customer as ready to pay.",
        person: c.assigned_to, action: "Send the payment link or close the sale", dueAt: due, overdue: Date.parse(due) <= now,
        mine: isMe(c.assigned_to), open: { tab: "livechat", phone: c.phone },
      });
    }
    const approvals = ((a.error ? [] : a.data) ?? []) as unknown as { id: string; conversation_id: string | null; created_at: string; kind: string | null; percent: number | null; reason: string | null }[];
    const convIds = approvals.map(x => x.conversation_id).filter(Boolean) as string[];
    if (convIds.length) {
      let cq = db().from("wa_conversations").select(CHAT_COLS).eq("tenant_id", v.tenantId).in("id", convIds);
      cq = scoped(cq);
      const { data } = await cq;
      const byId = new Map(((data ?? []) as unknown as ChatRow[]).map(c => [c.id, c]));
      for (const x of approvals) {
        const c = x.conversation_id ? byId.get(x.conversation_id) : undefined;
        if (!c) continue;
        const due = plus(x.created_at, target);
        items.push({
          key: `approval:${x.id}`, kind: "approval", title: c.name || `+${c.phone}`,
          detail: `${x.kind === "refund" ? "A refund" : `A ${x.percent ?? ""}% discount`.replace("A % ", "A ")} is waiting for approval.${x.reason ? ` ${x.reason}` : ""}`.slice(0, 160),
          person: c.assigned_to, action: x.kind === "refund" ? "Approve or decline the refund" : "Approve or decline the discount",
          dueAt: due, overdue: Date.parse(due) <= now, mine: isMe(c.assigned_to), open: { tab: "livechat", phone: c.phone },
        });
      }
    }
  }

  // 3. Orders left unpaid (admins only, as the Orders screen is). Due a day after ordering.
  if (v.user.role === "admin") {
    const { data: orders } = await db().from("wa_orders").select("id,phone,total_cents,currency,created_at").eq("tenant_id", v.tenantId)
      .eq("status", "pending").gte("created_at", new Date(now - 7 * 86_400_000).toISOString()).lte("created_at", new Date(now - 30 * 60_000).toISOString())
      .order("created_at", { ascending: true }).limit(50);
    const rows = (orders ?? []) as { id: string; phone: string; total_cents: number; currency: string; created_at: string }[];
    const owners = await contactOwners(v.tenantId, rows.map(o => o.phone));
    for (const o of rows) {
      const due = plus(o.created_at, 24 * 60);
      const owner = owners.get(o.phone);
      items.push({
        key: `order:${o.id}`, kind: "unpaid_order", title: `Order ${o.id.slice(0, 8)} · ${money(o.total_cents, o.currency)}`,
        detail: `+${o.phone} hasn't paid yet.`, person: owner?.name ?? null, action: "Follow up on payment",
        dueAt: due, overdue: Date.parse(due) <= now, mine: !!myId && owner?.id === myId, open: { tab: "catalog" },
      });
    }
  }

  // 4. Tasks due by the end of today, overdue ones, and ones without a date.
  const t = await listTasks(v, myId, { status: "open", limit: 200 }).catch(() => ({ tasks: [], setupPending: true }));
  if (t.setupPending) setupPending = true;
  for (const task of t.tasks) {
    if (task.dueAt && task.dueAt > endOfDay) continue;
    const phone = task.contactPhone;
    items.push({
      key: `task:${task.id}`, kind: "task", title: task.title,
      detail: [task.contactName || (phone ? `+${phone}` : ""), task.notes].filter(Boolean).join(" — ").slice(0, 160),
      person: task.assigneeName, action: "Do it, then mark done", dueAt: task.dueAt,
      overdue: !!task.dueAt && Date.parse(task.dueAt) <= now, mine: !!myId && task.assigneeId === myId,
      open: phone ? { tab: "livechat", phone } : { tab: "today" }, taskId: task.id,
    });
  }

  // 5. Review complaints: new ones to pick up, and follow-ups due today.
  {
    let rq = db().from("wa_reviews").select("id,author,rating,text,case_status,follow_up_at,assignee_id,channel_id,created_at")
      .eq("tenant_id", v.tenantId).in("case_status", ["new", "in_progress", "waiting_customer"]);
    rq = scoped(rq);
    const { data, error } = await rq.order("created_at", { ascending: true }).limit(100);
    if (error && missing(error)) setupPending = true;
    const rows = ((error ? [] : data) ?? []) as { id: string; author: string | null; rating: number | null; text: string | null; case_status: string; follow_up_at: string | null; assignee_id: string | null; created_at: string }[];
    const names = await userNames(v.tenantId, rows.map(x => x.assignee_id));
    for (const x of rows) {
      if (x.case_status !== "new" && (!x.follow_up_at || x.follow_up_at > endOfDay)) continue;
      const due = x.follow_up_at ?? plus(x.created_at, 24 * 60);
      items.push({
        key: `review:${x.id}`, kind: "review_case",
        title: `${x.rating ? `${x.rating}★ ` : ""}review from ${x.author || "a customer"}`,
        detail: (x.text ?? "").slice(0, 140), person: x.assignee_id ? names.get(x.assignee_id) ?? null : null,
        action: x.case_status === "new" ? "Pick up the complaint" : "Follow up on the complaint",
        dueAt: due, overdue: Date.parse(due) <= now, mine: !!myId && x.assignee_id === myId, open: { tab: "reviews", reviewId: x.id },
      });
    }
  }

  // 6. Promises made in social conversations that fall due today (Growth → Social).
  {
    let sq = db().from("wa_social_commitments").select("id,title,evidence,owner_email,due_at,conversation_id").eq("tenant_id", v.tenantId)
      .eq("status", "open").lte("due_at", endOfDay);
    if (v.user.role !== "admin") sq = sq.eq("owner_email", v.user.email.toLowerCase());
    const { data, error } = await sq.order("due_at", { ascending: true }).limit(50);
    for (const x of ((error ? [] : data) ?? []) as { id: string; title: string; evidence: string; owner_email: string | null; due_at: string }[]) {
      items.push({
        key: `commitment:${x.id}`, kind: "commitment", title: x.title, detail: x.evidence.slice(0, 140),
        person: x.owner_email, action: "Keep the promise, then mark it done", dueAt: x.due_at,
        overdue: Date.parse(x.due_at) <= now, mine: same(x.owner_email, me.email), open: { tab: "growth" },
      });
    }
  }

  // 7. Broken connections (admins): a restricted number, lost Instagram/Google
  // access, failing deliveries, money with no order. Due as soon as noticed.
  if (v.user.role === "admin") {
    const report = await healthReport(v.tenantId, now).catch(() => null);
    for (const p of report?.problems ?? []) {
      items.push({
        key: `connection:${p.key}`, kind: "connection", title: p.title, detail: p.detail.slice(0, 160),
        person: "Admins", action: p.fix.label, dueAt: p.since, overdue: p.severity === "critical", mine: true,
        open: p.fix.tab === "reviews" ? { tab: "reviews" } : { tab: p.fix.tab },
      });
    }
  }

  // 8. Bookings: confirm the ones coming up in the next day, and close the ones
  // that have ended (completed or a no-show) so Results and reminders stay true.
  {
    const r = await listBookings(v, myId, new Date(now - 3 * 86_400_000).toISOString(), new Date(now + 86_400_000).toISOString()).catch(() => ({ bookings: [], setupPending: false }));
    for (const b of r.bookings) {
      const who = b.name || `+${b.phone}`;
      if (b.status === "booked" && Date.parse(b.startsAt) > now) {
        items.push({ key: `booking:${b.id}:confirm`, kind: "booking", title: `${b.title} — ${who}`, detail: `Starts ${new Date(b.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit" })}${b.staffName ? ` with ${b.staffName}` : ""}.`,
          person: b.staffName, action: "Confirm the booking", dueAt: b.startsAt, overdue: false, mine: false, open: { tab: "bookings" } });
      } else if ((b.status === "booked" || b.status === "confirmed") && Date.parse(b.endsAt) < now - 3_600_000) {
        items.push({ key: `booking:${b.id}:close`, kind: "booking", title: `${b.title} — ${who}`, detail: "It has ended. Did they come?",
          person: b.staffName, action: "Mark it completed or a no-show", dueAt: b.endsAt, overdue: true, mine: false, open: { tab: "bookings" } });
      }
    }
  }

  // Overdue first (oldest deadline first), then by deadline; undated last.
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (Date.parse(a.dueAt ?? "9999") - Date.parse(b.dueAt ?? "9999")));
  return {
    items, settings, setupPending,
    counts: {
      overdue: items.filter(i => i.overdue).length,
      dueToday: items.filter(i => !i.overdue && i.dueAt && i.dueAt <= endOfDay).length,
      unassigned: items.filter(i => !i.person).length,
      mine: items.filter(i => i.mine).length,
    },
  };
}

function money(cents: number, currency = "INR"): string {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100); }
  catch { return `${currency} ${(cents / 100).toFixed(0)}`; }
}

async function userNames(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map();
  const { data } = await db().from("wa_users").select("id,name,email").eq("tenant_id", tenantId).in("id", list);
  return new Map(((data ?? []) as { id: string; name: string; email: string }[]).map(u => [u.id, u.name || u.email]));
}

/** phone → the teammate who looks after that customer, when one is set. */
async function contactOwners(tenantId: string, phones: string[]): Promise<Map<string, { id: string; name: string }>> {
  const list = [...new Set(phones)];
  if (!list.length) return new Map();
  const { data, error } = await tdb(tenantId).from("contacts").select("phone,owner_id").in("phone", list);
  if (error) return new Map();
  const rows = ((data ?? []) as unknown as { phone: string; owner_id: string | null }[]).filter(r => r.owner_id);
  const names = await userNames(tenantId, rows.map(r => r.owner_id));
  return new Map(rows.map(r => [r.phone, { id: r.owner_id as string, name: names.get(r.owner_id as string) ?? "" }]));
}
