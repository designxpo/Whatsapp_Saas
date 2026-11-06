// Emails for work that's late: a chat past the workspace's reply target, and
// a task past its due time. Only for workspaces that turned alert emails on
// (Today → Settings); the Today view itself always shows these.
//
// Raising: one row per event in wa_work_alerts, unique per (tenant, dedupe_key)
// — "reply:<chat>:<last customer message time>" and "task:<id>:<due>" — so a
// retried or overlapping run can't raise the same alert twice, and a customer
// who writes again starts a new one.
//
// Sending: only inside the workspace's alert hours (business time zone), one
// email per person per run listing everything new for them. Rows are claimed
// before sending. Each is re-checked first, so a chat answered (or a task done)
// in the meantime is never emailed about. Alerts not sent within a day are
// dropped rather than mailed late.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { applyEmailBrand } from "./email-brand";
import { brandForTenant } from "./brand-lookup";
import { unsubscribedRecipients, unsubscribeUrl } from "./emailprefs";
import { SITE_URL } from "./siteurl";
import { isAiEnabled } from "./messaging-settings";
import { UNANSWERED_AFTER_MS } from "./store";
import { normalizeWorkSettings, WORK_SETTINGS_KEY, type WorkSettings } from "./work-settings";
import { hourIn } from "./businessclock";

type AlertRow = {
  id: string; tenant_id: string; kind: "reply_overdue" | "task_due"; conversation_id: string | null; task_id: string | null;
  channel_id: string | null; recipient: string | null; title: string; body: string; created_at: string; dedupe_key: string;
};

const DAY = 86_400_000;
const missing = (e: { code?: string } | null | undefined) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");

/** Workspaces that want alert emails, with their settings. */
async function enabledTenants(limit = 200): Promise<Map<string, WorkSettings>> {
  const { data } = await db().from("wa_settings").select("tenant_id,value").eq("key", WORK_SETTINGS_KEY).limit(limit);
  const out = new Map<string, WorkSettings>();
  for (const r of (data ?? []) as { tenant_id: string; value: unknown }[]) {
    const s = normalizeWorkSettings(r.value);
    if (s.alertEmails) out.set(r.tenant_id, s);
  }
  return out;
}

async function insertAlert(tenantId: string, a: Omit<AlertRow, "id" | "tenant_id" | "created_at">): Promise<boolean> {
  const { error } = await tdb(tenantId).from("wa_work_alerts").insert(a);
  if (!error) return true;
  if (error.code !== "23505" && !missing(error)) console.error("[work-alerts] raise", tenantId, error.message);
  return false;
}

/** Raise alerts for overdue chats and due tasks. Returns how many were new. */
export async function sweepWorkAlerts(now = Date.now(), maxTenants = 50): Promise<number> {
  const tenants = await enabledTenants();
  let raised = 0, seen = 0;
  for (const [tenantId, s] of tenants) {
    if (seen++ >= maxTenants) break;
    const since = new Date(now - DAY).toISOString();
    const late = new Date(now - s.replyTargetMinutes * 60_000).toISOString();
    const aiOn = await isAiEnabled(tenantId).catch(() => true);
    let q = db().from("wa_conversations").select("id,name,phone,last_message,last_inbound_at,assigned_to,channel_id,status,bot_enabled")
      .eq("tenant_id", tenantId).eq("needs_reply", true).in("status", ["active", "escalated"])
      .gte("last_inbound_at", since).lte("last_inbound_at", late);
    if (aiOn) q = q.or(`status.eq.escalated,bot_enabled.eq.false,last_inbound_at.lte."${new Date(now - UNANSWERED_AFTER_MS).toISOString()}"`);
    const { data: chats } = await q.limit(100);
    for (const c of (chats ?? []) as { id: string; name: string | null; phone: string; last_message: string | null; last_inbound_at: string; assigned_to: string | null; channel_id: string | null }[]) {
      const ok = await insertAlert(tenantId, {
        kind: "reply_overdue", dedupe_key: `reply:${c.id}:${c.last_inbound_at}`, conversation_id: c.id, task_id: null,
        channel_id: c.channel_id, recipient: c.assigned_to,
        title: `${c.name || `+${c.phone}`} has waited over ${s.replyTargetMinutes} min for a reply`,
        body: (c.last_message ?? "").slice(0, 200),
      });
      if (ok) raised++;
    }
    const { data: tasks, error } = await tdb(tenantId).from("wa_tasks").select("id,title,due_at,assignee_id,created_by")
      .eq("status", "open").gte("due_at", since).lte("due_at", new Date(now).toISOString()).limit(100);
    if (error) continue;
    for (const t of (tasks ?? []) as unknown as { id: string; title: string; due_at: string; assignee_id: string | null; created_by: string }[]) {
      const ok = await insertAlert(tenantId, {
        kind: "task_due", dedupe_key: `task:${t.id}:${t.due_at}`, conversation_id: null, task_id: t.id, channel_id: null,
        recipient: t.assignee_id ? `user:${t.assignee_id}` : t.created_by, title: `Task due: ${t.title}`, body: "",
      });
      if (ok) raised++;
    }
  }
  return raised;
}

/** Is this alert still true? A chat answered, or a task done, is never emailed about. */
async function stillLate(a: AlertRow): Promise<boolean> {
  if (a.kind === "reply_overdue" && a.conversation_id) {
    const { data } = await db().from("wa_conversations").select("needs_reply,last_inbound_at").eq("tenant_id", a.tenant_id).eq("id", a.conversation_id).maybeSingle();
    const c = data as { needs_reply: boolean; last_inbound_at: string } | null;
    return !!c?.needs_reply && a.dedupe_key.endsWith(`:${c.last_inbound_at}`);
  }
  if (a.kind === "task_due" && a.task_id) {
    const { data } = await tdb(a.tenant_id).from("wa_tasks").select("status").eq("id", a.task_id).maybeSingle();
    return (data as { status: string } | null)?.status === "open";
  }
  return false;
}

type User = { id: string; name: string; email: string; role: string; team: string | null; active: boolean };

/** Who hears about an alert: the person it's assigned to, else the admins and the leads of that number's team. */
function recipientsFor(a: AlertRow, users: User[], channelTeam: Map<string, string | null>): string[] {
  const active = users.filter(u => u.active && /@/.test(u.email));
  const r = (a.recipient ?? "").trim().toLowerCase();
  if (r.startsWith("user:")) { const u = active.find(x => x.id === r.slice(5)); if (u) return [u.email.toLowerCase()]; }
  else if (r) {
    const u = active.find(x => x.email.toLowerCase() === r || (x.name ?? "").trim().toLowerCase() === r);
    if (u) return [u.email.toLowerCase()];
  }
  const team = a.channel_id ? channelTeam.get(a.channel_id) ?? null : null;
  return [...new Set(active.filter(u => u.role === "admin" || (u.role === "lead" && team && u.team === team)).map(u => u.email.toLowerCase()))];
}

/** Email new alerts, inside each workspace's alert hours. */
export async function drainWorkAlertEmails(now = Date.now()): Promise<{ emails: number }> {
  // Too old to be useful: drop rather than mail late.
  await db().from("wa_work_alerts").update({ emailed_at: new Date(now).toISOString(), email_error: "Not sent within a day" })
    .is("emailed_at", null).lt("created_at", new Date(now - DAY).toISOString()).then(() => {}, () => {});
  const { data, error } = await db().from("wa_work_alerts").select("id,tenant_id,kind,conversation_id,task_id,channel_id,recipient,title,body,created_at,dedupe_key")
    .is("emailed_at", null).order("created_at", { ascending: true }).limit(300);
  if (error || !data?.length) return { emails: 0 };
  const tenants = await enabledTenants();
  const byTenant = new Map<string, AlertRow[]>();
  for (const r of data as unknown as AlertRow[]) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r]);

  let emails = 0;
  for (const [tenantId, rows] of byTenant) {
    const s = tenants.get(tenantId);
    const mark = (ids: string[], why: string | null) => tdb(tenantId).from("wa_work_alerts").update({ emailed_at: new Date(now).toISOString(), email_error: why }).in("id", ids);
    if (!s) { await mark(rows.map(r => r.id), "Alert emails are off"); continue; }
    if (s.alertHours) {
      const h = hourIn(new Date(now));
      if (h < s.alertHours.start || h >= s.alertHours.end) continue;   // wait for working hours
    }
    if (!process.env.RESEND_API_KEY) { await mark(rows.map(r => r.id), "Email isn't set up on this deployment"); continue; }
    // Claim before sending, so two overlapping runs can't both mail the same alert.
    const claimed = await tdb(tenantId).from("wa_work_alerts").update({ emailed_at: new Date(now).toISOString() })
      .in("id", rows.map(r => r.id)).is("emailed_at", null).select("id");
    const mine = new Set(((claimed.data ?? []) as unknown as { id: string }[]).map(r => r.id));
    const batch: AlertRow[] = [];
    for (const r of rows) if (mine.has(r.id)) { if (await stillLate(r)) batch.push(r); else await mark([r.id], "Already handled"); }
    if (!batch.length) continue;

    const { data: u } = await db().from("wa_users").select("id,name,email,role,team,active").eq("tenant_id", tenantId);
    const users = (u ?? []) as User[];
    const chIds = [...new Set(batch.map(b => b.channel_id).filter(Boolean))] as string[];
    const { data: ch } = chIds.length ? await tdb(tenantId).from("wa_channels").select("id,team").in("id", chIds) : { data: [] };
    const channelTeam = new Map(((ch ?? []) as unknown as { id: string; team: string | null }[]).map(c => [c.id, c.team]));
    const optedOut = await unsubscribedRecipients(tenantId, "work_alerts");
    const perPerson = new Map<string, AlertRow[]>();
    for (const a of batch) for (const to of recipientsFor(a, users, channelTeam)) if (!optedOut.has(to)) perPerson.set(to, [...(perPerson.get(to) ?? []), a]);
    if (!perPerson.size) { await mark(batch.map(b => b.id), "No one to email"); continue; }

    const brand = await brandForTenant(tenantId);
    for (const [to, list] of perPerson) {
      const unsub = unsubscribeUrl(tenantId, "work_alerts", to);
      const chats = list.filter(a => a.kind === "reply_overdue").length;
      const subject = list.length === 1 ? list[0].title : `${list.length} things are waiting for you${chats ? ` (${chats} customer${chats === 1 ? "" : "s"})` : ""}`;
      const mail = applyEmailBrand(brand, {
        preheader: list.map(a => a.title).join(" · ").slice(0, 110),
        heading: chats ? "Customers are waiting" : "Tasks are due",
        paragraphs: list.slice(0, 10).map(a => `${a.title}${a.body ? ` — “${a.body}”` : ""}`).concat(list.length > 10 ? [`…and ${list.length - 10} more in Today.`] : []),
        cta: { label: "Open Today", href: "/admin?tab=today" },
        footerReason: "You're getting this because overdue alerts are on for your workspace. An admin can turn them off in Today → Settings.",
        unsubscribeHref: unsub,
      }, SITE_URL, subject);
      const { html, text } = renderEmail(mail.opts, mail.siteUrl);
      const r = await sendEmail({ to, subject: mail.subject, html, text, unsubscribeUrl: mail.opts.unsubscribeHref ?? unsub, type: "work_alert", tenantId, ...(mail.fromName ? { fromName: mail.fromName, fromEmail: mail.fromEmail } : {}) })
        .catch(e => ({ ok: false, error: e instanceof Error ? e.message : "send failed" }));
      if (r.ok) emails++;
      else await mark(list.map(a => a.id), `Couldn't email ${to}`);
    }
  }
  return { emails };
}
