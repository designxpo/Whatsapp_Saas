// Follow-ups with a person and a deadline, and who looks after each customer.
//
// A task can be about a customer (contact), a chat, or an order, or stand on
// its own. "Next action" for a customer is simply their earliest open task, so
// there is one source of truth instead of a second free-text field to drift.
//
// Visibility follows the inbox: admins and unscoped people see every task; a
// teammate limited to their team's numbers sees tasks assigned to or created by
// them, and tasks about chats or customers on their team's numbers.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import type { ReviewViewer as WorkViewer } from "./review-access";

export type { WorkViewer };
export type TaskStatus = "open" | "done" | "cancelled";

export interface Task {
  id: string; title: string; notes: string; dueAt: string | null; status: TaskStatus;
  assigneeId: string | null; assigneeName: string | null;
  contactId: string | null; contactName: string | null; contactPhone: string | null;
  conversationId: string | null; orderId: string | null;
  createdBy: string; createdAt: string; doneAt: string | null; doneBy: string | null;
}

type Row = {
  id: string; title: string; notes: string; due_at: string | null; status: TaskStatus; assignee_id: string | null;
  contact_id: string | null; conversation_id: string | null; order_id: string | null;
  created_by: string; created_at: string; done_at: string | null; done_by: string | null;
};

const COLS = "id,title,notes,due_at,status,assignee_id,contact_id,conversation_id,order_id,created_by,created_at,done_at,done_by";
export const missingTable = (e: { code?: string } | null | undefined) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");

/** Turn rows into tasks with the assignee's and customer's names filled in. */
async function hydrate(tenantId: string, rows: Row[]): Promise<Task[]> {
  const userIds = [...new Set(rows.map(r => r.assignee_id).filter(Boolean))] as string[];
  const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))] as string[];
  const [u, c] = await Promise.all([
    userIds.length ? db().from("wa_users").select("id,name,email").eq("tenant_id", tenantId).in("id", userIds) : Promise.resolve({ data: [] }),
    contactIds.length ? tdb(tenantId).from("contacts").select("id,name,phone").in("id", contactIds) : Promise.resolve({ data: [] }),
  ]);
  const users = new Map(((u.data ?? []) as { id: string; name: string; email: string }[]).map(x => [x.id, x.name || x.email]));
  const contacts = new Map(((c.data ?? []) as unknown as { id: string; name: string; phone: string }[]).map(x => [x.id, x]));
  return rows.map(r => ({
    id: r.id, title: r.title, notes: r.notes ?? "", dueAt: r.due_at, status: r.status,
    assigneeId: r.assignee_id, assigneeName: r.assignee_id ? users.get(r.assignee_id) ?? null : null,
    contactId: r.contact_id, contactName: r.contact_id ? contacts.get(r.contact_id)?.name || null : null,
    contactPhone: r.contact_id ? contacts.get(r.contact_id)?.phone ?? null : null,
    conversationId: r.conversation_id, orderId: r.order_id,
    createdBy: r.created_by, createdAt: r.created_at, doneAt: r.done_at, doneBy: r.done_by,
  }));
}

/** May this viewer see this task? Unscoped viewers see all of them. */
async function visibleRows(v: WorkViewer, rows: Row[], myId: string | null): Promise<Row[]> {
  if (!v.allowed) return rows;
  const allowed = new Set(v.allowed);
  const convIds = [...new Set(rows.map(r => r.conversation_id).filter(Boolean))] as string[];
  const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))] as string[];
  const [cv, ct] = await Promise.all([
    convIds.length ? db().from("wa_conversations").select("id,channel_id").eq("tenant_id", v.tenantId).in("id", convIds) : Promise.resolve({ data: [] }),
    contactIds.length ? tdb(v.tenantId).from("contacts").select("id,channel_id").in("id", contactIds) : Promise.resolve({ data: [] }),
  ]);
  const convCh = new Map(((cv.data ?? []) as { id: string; channel_id: string | null }[]).map(x => [x.id, x.channel_id]));
  const contactCh = new Map(((ct.data ?? []) as unknown as { id: string; channel_id: string | null }[]).map(x => [x.id, x.channel_id]));
  const me = v.user.email.toLowerCase();
  return rows.filter(r =>
    (myId && r.assignee_id === myId) || r.created_by.toLowerCase() === me
    || (r.conversation_id && allowed.has(convCh.get(r.conversation_id) ?? ""))
    || (r.contact_id && allowed.has(contactCh.get(r.contact_id) ?? "")));
}

export async function listTasks(v: WorkViewer, myId: string | null, opts: {
  contactId?: string; conversationId?: string; status?: TaskStatus | "all"; assigneeId?: string; dueBefore?: string; limit?: number;
} = {}): Promise<{ tasks: Task[]; setupPending?: boolean }> {
  let q = tdb(v.tenantId).from("wa_tasks").select(COLS);
  if (opts.status !== "all") q = q.eq("status", opts.status ?? "open");
  if (opts.contactId) q = q.eq("contact_id", opts.contactId);
  if (opts.conversationId) q = q.eq("conversation_id", opts.conversationId);
  if (opts.assigneeId) q = q.eq("assignee_id", opts.assigneeId);
  if (opts.dueBefore) q = q.lte("due_at", opts.dueBefore);
  const { data, error } = await q.order("due_at", { ascending: true, nullsFirst: false }).limit(opts.limit ?? 200);
  if (error) return missingTable(error) ? { tasks: [], setupPending: true } : Promise.reject(error);
  return { tasks: await hydrate(v.tenantId, await visibleRows(v, (data ?? []) as unknown as Row[], myId)) };
}

export interface TaskInput {
  title?: string; notes?: string; dueAt?: string | null; assigneeId?: string | null;
  contactId?: string | null; conversationId?: string | null; orderId?: string | null;
}

/** Check every id belongs to this workspace (a guessed id from elsewhere is refused). */
async function validate(tenantId: string, input: TaskInput): Promise<string | null> {
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return "Write what needs doing.";
    if (t.length > 300) return "Keep the task under 300 characters.";
  }
  if (input.dueAt && !Number.isFinite(Date.parse(input.dueAt))) return "That due date isn't valid.";
  if (input.assigneeId) {
    const { data } = await db().from("wa_users").select("id,active").eq("tenant_id", tenantId).eq("id", input.assigneeId).maybeSingle();
    if (!data || !(data as { active: boolean }).active) return "That teammate isn't in this workspace.";
  }
  if (input.contactId) {
    const { data } = await tdb(tenantId).from("contacts").select("id").eq("id", input.contactId).maybeSingle();
    if (!data) return "That customer isn't in this workspace.";
  }
  if (input.conversationId) {
    const { data } = await db().from("wa_conversations").select("id").eq("tenant_id", tenantId).eq("id", input.conversationId).maybeSingle();
    if (!data) return "That chat isn't in this workspace.";
  }
  if (input.orderId) {
    const { data } = await db().from("wa_orders").select("id").eq("tenant_id", tenantId).eq("id", input.orderId).maybeSingle();
    if (!data) return "That order isn't in this workspace.";
  }
  return null;
}

export async function createTask(v: WorkViewer, myId: string | null, input: TaskInput): Promise<{ task?: Task; error?: string; status?: number }> {
  if (!input.title?.trim()) return { error: "Write what needs doing.", status: 400 };
  const bad = await validate(v.tenantId, input);
  if (bad) return { error: bad, status: 400 };
  const { data, error } = await tdb(v.tenantId).from("wa_tasks").insert({
    status: "open", title: input.title.trim(), notes: (input.notes ?? "").trim().slice(0, 4000),
    due_at: input.dueAt ? new Date(input.dueAt).toISOString() : null,
    // Unassigned tasks default to whoever wrote them, so nothing is born ownerless.
    assignee_id: input.assigneeId === undefined ? myId : input.assigneeId,
    contact_id: input.contactId ?? null, conversation_id: input.conversationId ?? null, order_id: input.orderId ?? null,
    created_by: v.user.email.toLowerCase(),
  }).select(COLS).single();
  if (error) return missingTable(error) ? { error: "Tasks are still being set up for your workspace. Try again shortly.", status: 503 } : { error: error.message, status: 500 };
  return { task: (await hydrate(v.tenantId, [data as unknown as Row]))[0] };
}

export async function updateTask(v: WorkViewer, myId: string | null, id: string, patch: TaskInput & { status?: TaskStatus }): Promise<{ task?: Task; error?: string; status?: number }> {
  const { data: cur } = await tdb(v.tenantId).from("wa_tasks").select(COLS).eq("id", id).maybeSingle();
  if (!cur || !(await visibleRows(v, [cur as unknown as Row], myId)).length) return { error: "Task not found", status: 404 };
  const bad = await validate(v.tenantId, patch);
  if (bad) return { error: bad, status: 400 };
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.notes !== undefined) row.notes = patch.notes.trim().slice(0, 4000);
  if (patch.dueAt !== undefined) row.due_at = patch.dueAt ? new Date(patch.dueAt).toISOString() : null;
  if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
  if (patch.status !== undefined) {
    if (!["open", "done", "cancelled"].includes(patch.status)) return { error: "Unknown status", status: 400 };
    row.status = patch.status;
    row.done_at = patch.status === "open" ? null : new Date().toISOString();
    row.done_by = patch.status === "open" ? null : v.user.email.toLowerCase();
  }
  if (!Object.keys(row).length) return { task: (await hydrate(v.tenantId, [cur as unknown as Row]))[0] };
  const { data, error } = await tdb(v.tenantId).from("wa_tasks").update(row).eq("id", id).select(COLS).single();
  if (error) return { error: error.message, status: 500 };
  return { task: (await hydrate(v.tenantId, [data as unknown as Row]))[0] };
}

/** Who looks after this customer. Admins and leads only; the teammate must be active here. */
export async function setContactOwner(v: WorkViewer, contactId: string, ownerId: string | null): Promise<{ ok?: true; error?: string; status?: number }> {
  if (!v.canManage) return { error: "Only an admin or team lead can change who looks after a customer.", status: 403 };
  const { data: c } = await tdb(v.tenantId).from("contacts").select("id,channel_id").eq("id", contactId).maybeSingle();
  if (!c || (v.allowed && !v.allowed.includes((c as unknown as { channel_id: string | null }).channel_id ?? ""))) return { error: "Customer not found", status: 404 };
  if (ownerId) {
    const bad = await validate(v.tenantId, { assigneeId: ownerId });
    if (bad) return { error: bad, status: 400 };
  }
  const { error } = await tdb(v.tenantId).from("contacts").update({ owner_id: ownerId }).eq("id", contactId);
  if (error) return missingTable(error) ? { error: "Customer owners are still being set up for your workspace. Try again shortly.", status: 503 } : { error: error.message, status: 500 };
  return { ok: true };
}
