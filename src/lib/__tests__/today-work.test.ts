// Phase 1 "Today": the work list (who, what, by when), who can see what, tasks
// and customer owners, reply times, overdue alert emails, and the one unpaid-
// order reminder. Real lib code over the in-memory database; names synthetic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({
  m: null as unknown as MemDb,
  settings: {} as Record<string, unknown>,
  aiOn: true,
  emails: [] as { to: string; subject: string; text: string }[],
  optedOut: new Set<string>(),
  optedOutPhones: new Set<string>(),
  sent: [] as { phone: string; body: string; channel: string }[],
  logged: [] as { conversationId: string; body: string }[],
}));

vi.mock("../supabase", () => ({ db: () => h.m.client }));
vi.mock("../tenantdb", () => ({
  tdb: (t: string) => ({
    from: (tb: string) => {
      const b = h.m.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert;
      b.insert = (p: unknown) => ins(Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  }),
}));
vi.mock("../store", () => ({
  UNANSWERED_AFTER_MS: 120_000,
  getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}|${k}` in h.settings ? h.settings[`${t}|${k}`] : d),
  setTenantSetting: async (t: string, k: string, v: unknown) => { h.settings[`${t}|${k}`] = v; },
  isOptedOutStrict: async (phone: string) => h.optedOutPhones.has(phone),
  appendConvMessage: async (p: { conversationId: string; body: string }) => { h.logged.push({ conversationId: p.conversationId, body: p.body }); return { id: "m", createdAt: "" }; },
}));
vi.mock("../messaging-settings", () => ({ isAiEnabled: async () => h.aiOn }));
vi.mock("../email", () => ({ sendEmail: async (e: { to: string; subject: string; text: string }) => { h.emails.push(e); return { ok: true }; } }));
vi.mock("../emailtemplate", () => ({ renderEmail: (o: { paragraphs: string[] }) => ({ html: "", text: o.paragraphs.join("\n") }) }));
vi.mock("../email-brand", () => ({ applyEmailBrand: (_b: unknown, opts: unknown, siteUrl: string, subject: string) => ({ opts, siteUrl, subject }) }));
vi.mock("../brand-lookup", () => ({ brandForTenant: async () => null }));
vi.mock("../emailprefs", () => ({ unsubscribedRecipients: async () => h.optedOut, unsubscribeUrl: () => "https://x/unsub" }));
vi.mock("../channels", () => ({
  listChannels: async () => [{ id: "ch1", kind: "whatsapp", isDefault: true }, { id: "ch2", kind: "whatsapp", isDefault: false }],
  isLiveChannel: () => true,
}));
vi.mock("../whatsapp", () => ({ sendText: async (phone: string, body: string, ch: { id: string }) => { h.sent.push({ phone, body, channel: ch.id }); return { id: `wamid.${h.sent.length}` }; } }));
vi.mock("../feature-guard", () => ({ accountCanSend: async () => true }));
const who = vi.hoisted(() => ({ ctx: null as null | { v: unknown; myId: string | null } }));
vi.mock("../work-access", () => ({ workContext: async () => who.ctx }));

import { normalizeWorkSettings, DEFAULT_WORK_SETTINGS, WORK_SETTINGS_KEY } from "../work-settings";
import { buildToday } from "../today";
import { createTask, listTasks, setContactOwner, updateTask, type WorkViewer } from "../tasks";
import { measureWaits, responseTimes } from "../response-times";
import { sweepWorkAlerts, drainWorkAlertEmails } from "../work-alerts";
import { drainUnpaidReminders, unpaidMessage } from "../unpaid-orders";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";
// 11:30 in India — inside the default 9–20 alert hours.
const NOW = Date.parse("2026-11-06T06:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ahead = (min: number) => new Date(NOW + min * 60_000).toISOString();

const admin: WorkViewer = { user: { email: "asha@biz.test", name: "Asha", role: "admin", tenantId: T }, tenantId: T, allowed: null, canManage: true };
const ben: WorkViewer = { user: { email: "ben@biz.test", name: "Ben", role: "member", team: "sales", tenantId: T }, tenantId: T, allowed: ["ch2"], canManage: false };

function seed() {
  h.m = memdb({ wa_work_alerts: [["tenant_id", "dedupe_key"]] });
  h.settings = {}; h.aiOn = true; h.emails = []; h.optedOut = new Set(); h.optedOutPhones = new Set(); h.sent = []; h.logged = [];
  const t = h.m.tables;
  t.wa_users = [
    { id: "u1", tenant_id: T, name: "Asha", email: "asha@biz.test", role: "admin", team: null, active: true },
    { id: "u2", tenant_id: T, name: "Ben", email: "ben@biz.test", role: "member", team: "sales", active: true },
    { id: "u3", tenant_id: T, name: "Lea", email: "lea@biz.test", role: "lead", team: "sales", active: true },
    { id: "u4", tenant_id: T, name: "Old", email: "old@biz.test", role: "member", team: null, active: false },
    { id: "ux", tenant_id: O, name: "Xen", email: "xen@other.test", role: "admin", team: null, active: true },
  ];
  t.wa_channels = [{ id: "ch1", tenant_id: T, team: null }, { id: "ch2", tenant_id: T, team: "sales" }];
  const chat = (id: string, x: Record<string, unknown>) => ({ id, tenant_id: T, name: id.toUpperCase(), phone: `9198765000${id.slice(1).padStart(2, "0")}`, platform: "whatsapp", needs_reply: true, status: "active", bot_enabled: true, assigned_to: null, channel_id: "ch1", last_message: "hello?", ready_to_pay: false, ...x });
  t.wa_conversations = [
    chat("c1", { last_inbound_at: ago(20), assigned_to: "Asha" }),                       // overdue, Asha's
    chat("c2", { last_inbound_at: ago(1), status: "escalated", channel_id: "ch2" }),      // handed over, due in 14 min
    chat("c3", { last_inbound_at: ago(1) }),                                              // the AI still has its 2 minutes
    chat("c4", { last_inbound_at: ago(30), tenant_id: O }),                               // another business
    chat("c5", { last_inbound_at: ago(40), needs_reply: false, ready_to_pay: true, lead_scored_at: ago(5) }),
    chat("c6", { last_inbound_at: ago(50), needs_reply: false }),
    chat("c7", { last_inbound_at: ago(25), status: "escalated", channel_id: "ch2" }),     // overdue, nobody assigned, sales team
  ];
  t.wa_approval_requests = [
    { id: "a1", tenant_id: T, conversation_id: "c6", kind: "refund", percent: null, reason: "Item arrived damaged", status: "pending", created_at: ago(30) },
    { id: "a2", tenant_id: T, conversation_id: "c6", kind: "discount", percent: 10, status: "approved", created_at: ago(30) },
  ];
  t.contacts = [
    { id: "k1", tenant_id: T, name: "Kiran", phone: "919876500901", owner_id: "u1", channel_id: "ch1" },
    { id: "k2", tenant_id: T, name: "Meera", phone: "919876500902", owner_id: null, channel_id: "ch2" },
    { id: "kx", tenant_id: O, name: "Other", phone: "919876500903", owner_id: null, channel_id: null },
  ];
  t.wa_orders = [
    { id: "o1aaaaaa-1", tenant_id: T, phone: "919876500901", total_cents: 249900, currency: "INR", status: "pending", created_at: ago(120) },
    { id: "o2aaaaaa-2", tenant_id: T, phone: "919876500901", total_cents: 100, currency: "INR", status: "paid", created_at: ago(120) },
    { id: "o3aaaaaa-3", tenant_id: T, phone: "919876500902", total_cents: 100, currency: "INR", status: "pending", created_at: ago(10) },
  ];
  t.wa_tasks = [
    { id: "t1", tenant_id: T, title: "Call Kiran back", notes: "", due_at: ago(60), status: "open", assignee_id: "u2", contact_id: "k1", conversation_id: null, order_id: null, created_by: "asha@biz.test", created_at: ago(200) },
    { id: "t2", tenant_id: T, title: "Next week", notes: "", due_at: ahead(3 * 1440), status: "open", assignee_id: "u1", contact_id: null, conversation_id: null, order_id: null, created_by: "asha@biz.test", created_at: ago(200) },
    { id: "t3", tenant_id: T, title: "Done already", notes: "", due_at: ago(60), status: "done", assignee_id: "u1", contact_id: null, conversation_id: null, order_id: null, created_by: "asha@biz.test", created_at: ago(200) },
    { id: "t4", tenant_id: T, title: "Undated", notes: "", due_at: null, status: "open", assignee_id: "u1", contact_id: null, conversation_id: null, order_id: null, created_by: "asha@biz.test", created_at: ago(200) },
  ];
  t.wa_reviews = [
    { id: "r1", tenant_id: T, author: "Ravi", rating: 2, text: "Cold food", case_status: "new", follow_up_at: null, assignee_id: null, channel_id: "ch1", created_at: ago(120) },
    { id: "r2", tenant_id: T, author: "Sam", rating: 1, text: "Rude", case_status: "in_progress", follow_up_at: ahead(3 * 1440), assignee_id: "u1", channel_id: "ch1", created_at: ago(120) },
    { id: "r3", tenant_id: T, author: "Tia", rating: 3, text: "Late", case_status: "in_progress", follow_up_at: ago(60), assignee_id: "u1", channel_id: "ch1", created_at: ago(500) },
  ];
  t.wa_social_commitments = [
    { id: "s1", tenant_id: T, title: "Send the brochure", evidence: "I'll send it today", owner_email: "asha@biz.test", due_at: ago(120), status: "open", conversation_id: "c1" },
    { id: "s2", tenant_id: T, title: "Later", evidence: "", owner_email: "asha@biz.test", due_at: ahead(3 * 1440), status: "open", conversation_id: "c1" },
  ];
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); seed(); process.env.RESEND_API_KEY = "re_test"; });
afterEach(() => { vi.useRealTimers(); delete process.env.RESEND_API_KEY; });

describe("work settings", () => {
  it("defaults to no emails and no customer reminders, and clamps what's saved", () => {
    expect(normalizeWorkSettings(undefined)).toEqual(DEFAULT_WORK_SETTINGS);
    expect(DEFAULT_WORK_SETTINGS.alertEmails).toBe(false);
    expect(DEFAULT_WORK_SETTINGS.unpaidReminder.enabled).toBe(false);
    const s = normalizeWorkSettings({ replyTargetMinutes: 0, alertEmails: "yes", alertHours: { start: 20, end: 9 }, unpaidReminder: { enabled: true, afterMinutes: 1 } });
    expect(s.replyTargetMinutes).toBe(1);
    expect(s.alertEmails).toBe(false);                       // only a real true turns it on
    expect(s.alertHours).toEqual(DEFAULT_WORK_SETTINGS.alertHours);
    expect(s.unpaidReminder).toEqual({ enabled: true, afterMinutes: 15 });
    expect(normalizeWorkSettings({ replyTargetMinutes: 99999, alertHours: null }).replyTargetMinutes).toBe(1440);
    expect(normalizeWorkSettings({ alertHours: null }).alertHours).toBeNull();
  });
});

describe("Today", () => {
  it("lists every kind of waiting work with a person, an action and a deadline, overdue first", async () => {
    const r = await buildToday(admin, "u1", NOW);
    const keys = r.items.map(i => i.key);
    expect(new Set(keys)).toEqual(new Set([
      "reply:c1", "reply:c2", "reply:c7", "ready:c5", "approval:a1", "order:o1aaaaaa-1",
      "task:t1", "task:t4", "review:r1", "review:r3", "commitment:s1",
    ]));
    // Overdue items come first, then by deadline; undated last.
    const firstNotOverdue = r.items.findIndex(i => !i.overdue);
    expect(r.items.slice(0, firstNotOverdue).every(i => i.overdue)).toBe(true);
    expect(r.items.slice(firstNotOverdue).every(i => !i.overdue)).toBe(true);
    expect(r.items.at(-1)!.key).toBe("task:t4");

    const c1 = r.items.find(i => i.key === "reply:c1")!;
    expect(c1).toMatchObject({ overdue: true, person: "Asha", mine: true, action: "Reply", open: { tab: "livechat" } });
    expect(c1.dueAt).toBe(new Date(Date.parse(ago(20)) + 15 * 60_000).toISOString());
    expect(r.items.find(i => i.key === "reply:c2")).toMatchObject({ overdue: false, person: null });
    expect(r.items.find(i => i.key === "approval:a1")).toMatchObject({ action: "Approve or decline the refund", overdue: true });
    expect(r.items.find(i => i.key === "order:o1aaaaaa-1")).toMatchObject({ person: "Asha", mine: true, overdue: false, open: { tab: "catalog" } });
    expect(r.items.find(i => i.key === "task:t1")).toMatchObject({ person: "Ben", mine: false, overdue: true, open: { tab: "livechat", phone: "919876500901" } });
    expect(r.items.find(i => i.key === "review:r1")).toMatchObject({ person: null, action: "Pick up the complaint" });
    expect(r.items.find(i => i.key === "commitment:s1")).toMatchObject({ mine: true, open: { tab: "growth" } });
    expect(r.counts.unassigned).toBe(r.items.filter(i => !i.person).length);
  });

  it("follows the workspace's reply target", async () => {
    h.settings[`${T}|${WORK_SETTINGS_KEY}`] = { replyTargetMinutes: 60 };
    const r = await buildToday(admin, "u1", NOW);
    expect(r.items.find(i => i.key === "reply:c1")!.overdue).toBe(false);
  });

  it("with the AI off, every unanswered chat waits for a person straight away", async () => {
    h.aiOn = false;
    const r = await buildToday(admin, "u1", NOW);
    expect(r.items.some(i => i.key === "reply:c3")).toBe(true);
  });

  it("a teammate limited to their team's numbers sees only that team's work, and no orders", async () => {
    const r = await buildToday(ben, "u2", NOW);
    expect(new Set(r.items.map(i => i.key))).toEqual(new Set(["reply:c2", "reply:c7", "task:t1"]));
    expect(r.items.find(i => i.key === "task:t1")!.mine).toBe(true);
  });
});

describe("tasks and customer owners", () => {
  it("creates a task for the writer by default and refuses ids from another workspace", async () => {
    const ok = await createTask(admin, "u1", { title: "  Send price list ", contactId: "k1" });
    expect(ok.task).toMatchObject({ title: "Send price list", assigneeId: "u1", assigneeName: "Asha", contactName: "Kiran" });
    expect((await createTask(admin, "u1", { title: "x", assigneeId: "ux" })).status).toBe(400);
    expect((await createTask(admin, "u1", { title: "x", assigneeId: "u4" })).error).toMatch(/isn't in this workspace/);
    expect((await createTask(admin, "u1", { title: "x", contactId: "kx" })).status).toBe(400);
    expect((await createTask(admin, "u1", { title: "   " })).status).toBe(400);
    expect((await createTask(admin, "u1", { title: "x", dueAt: "soon" })).status).toBe(400);
  });

  it("hides other teams' tasks from a scoped teammate, and records who finished a task", async () => {
    const mine = await listTasks(ben, "u2");
    expect(mine.tasks.map(t => t.id)).toEqual(["t1"]);
    expect((await updateTask(ben, "u2", "t4", { status: "done" })).status).toBe(404);
    const done = await updateTask(ben, "u2", "t1", { status: "done" });
    expect(done.task).toMatchObject({ status: "done", doneBy: "ben@biz.test" });
    expect(done.task!.doneAt).toBeTruthy();
    expect((await updateTask(ben, "u2", "t1", { status: "open" })).task).toMatchObject({ status: "open", doneAt: null, doneBy: null });
  });

  it("only admins and leads set who looks after a customer, within the workspace", async () => {
    expect((await setContactOwner(ben, "k2", "u2")).status).toBe(403);
    expect(await setContactOwner(admin, "k2", "u2")).toEqual({ ok: true });
    expect(h.m.tables.contacts.find(c => c.id === "k2")!.owner_id).toBe("u2");
    expect((await setContactOwner(admin, "k2", "ux")).status).toBe(400);
    expect((await setContactOwner(admin, "kx", "u1")).status).toBe(404);
    const lead: WorkViewer = { ...ben, user: { ...ben.user, role: "lead" }, canManage: true };
    expect((await setContactOwner(lead, "k1", "u2")).status).toBe(404);   // another team's customer
  });
});

describe("reply times", () => {
  it("measures each wait from the customer's first unanswered message, and says who closed it", () => {
    const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
    const w = measureWaits([
      { conversation_id: "x", role: "user", source: "inbound", created_at: at(0) },
      { conversation_id: "x", role: "user", source: "inbound", created_at: at(1) },
      { conversation_id: "x", role: "assistant", source: "bot", created_at: at(3) },
      { conversation_id: "x", role: "user", source: "inbound", created_at: at(10) },
      { conversation_id: "x", role: "assistant", source: "agent", created_at: at(25) },
      { conversation_id: "x", role: "assistant", source: "agent", created_at: at(26) },
      { conversation_id: "x", role: "user", source: "inbound", created_at: at(30) },   // still waiting: not counted
    ]);
    expect(w).toEqual([{ minutes: 3, byPerson: false }, { minutes: 15, byPerson: true }]);
  });

  it("summarises the workspace's own messages only", async () => {
    const msg = (c: string, tenant: string, role: string, source: string, min: number) => ({ conversation_id: c, tenant_id: tenant, role, source, channel_id: "ch1", created_at: ago(min) });
    h.m.tables.wa_conv_messages = [
      msg("c1", T, "user", "inbound", 100), msg("c1", T, "assistant", "bot", 98),
      msg("c2", T, "user", "inbound", 90), msg("c2", T, "assistant", "agent", 60),
      msg("c4", O, "user", "inbound", 90), msg("c4", O, "assistant", "agent", 10),
    ];
    const r = await responseTimes(T, { channelIds: null, targetMinutes: 15, now: NOW });
    expect(r).toMatchObject({ answered: 2, withinTargetPct: 50, byPeople: { answered: 1, medianMinutes: 30 } });
  });
});

describe("overdue alert emails", () => {
  const enable = (tenant = T, extra: Record<string, unknown> = {}) => h.m.tables.wa_settings = [
    ...(h.m.tables.wa_settings ?? []), { tenant_id: tenant, key: WORK_SETTINGS_KEY, value: { alertEmails: true, ...extra } },
  ];

  it("raises nothing for a workspace that hasn't turned emails on", async () => {
    expect(await sweepWorkAlerts(NOW)).toBe(0);
    expect(h.m.tables.wa_work_alerts ?? []).toHaveLength(0);
  });

  it("raises each overdue chat and due task once, then emails the person responsible", async () => {
    enable();
    expect(await sweepWorkAlerts(NOW)).toBe(3);              // c1, c7, task t1
    expect(await sweepWorkAlerts(NOW)).toBe(0);              // same events: no duplicates
    const r = await drainWorkAlertEmails(NOW);
    const to = h.emails.map(e => e.to).sort();
    // c1 → Asha (assigned). t1 → Ben (assignee). c7 has no one → admins + the sales lead, never the member.
    expect(to).toEqual(["asha@biz.test", "ben@biz.test", "lea@biz.test"]);
    expect(r.emails).toBe(3);
    expect(h.emails.find(e => e.to === "ben@biz.test")!.subject).toBe("Task due: Call Kiran back");
    expect(h.emails.find(e => e.to === "asha@biz.test")!.subject).toMatch(/2 things are waiting/);
    expect((await drainWorkAlertEmails(NOW)).emails).toBe(0);    // claimed: never mailed twice
  });

  it("waits for working hours, and skips anything handled in the meantime", async () => {
    enable();
    await sweepWorkAlerts(NOW);
    const night = Date.parse("2026-11-06T18:00:00Z");              // 23:30 in India
    expect((await drainWorkAlertEmails(night)).emails).toBe(0);
    expect(h.m.tables.wa_work_alerts.every(a => a.emailed_at == null)).toBe(true);
    // Answered and done before morning: nothing to tell anyone.
    h.m.tables.wa_conversations.find(c => c.id === "c1")!.needs_reply = false;
    h.m.tables.wa_conversations.find(c => c.id === "c7")!.last_inbound_at = ago(0);   // wrote again: a new wait
    h.m.tables.wa_tasks.find(t => t.id === "t1")!.status = "done";
    expect((await drainWorkAlertEmails(NOW)).emails).toBe(0);
    expect(h.m.tables.wa_work_alerts.every(a => a.email_error === "Already handled")).toBe(true);
  });

  it("respects a teammate who unsubscribed", async () => {
    enable();
    h.optedOut = new Set(["asha@biz.test"]);
    await sweepWorkAlerts(NOW);
    await drainWorkAlertEmails(NOW);
    expect(h.emails.map(e => e.to)).not.toContain("asha@biz.test");
  });
});

describe("unpaid order reminder", () => {
  const orders = () => {
    h.m.tables.wa_settings = [
      { tenant_id: T, key: WORK_SETTINGS_KEY, value: { unpaidReminder: { enabled: true, afterMinutes: 60 } } },
      { tenant_id: O, key: WORK_SETTINGS_KEY, value: {} },
    ];
    const o = (id: string, phone: string, x: Record<string, unknown>) => ({ id, tenant_id: T, phone, total_cents: 249900, currency: "INR", status: "pending", payment_url: `https://rzp.io/${id}`, unpaid_reminded_at: null, created_at: ago(120), ...x });
    h.m.tables.wa_orders = [
      o("u1-order", "919876500911", {}),
      o("u2-order", "919876500912", { created_at: ago(30) }),                 // too soon
      o("u3-order", "919876500913", { payment_url: null }),                   // no link saved
      o("u4-order", "919876500914", {}),                                      // outside the 24h window
      o("u5-order", "919876500915", {}),                                      // opted out
      o("u6-order", "919876500916", { created_at: ago(25 * 60) }),            // too old for the window
      { ...o("ox-order", "919876500917", {}), tenant_id: O },                 // reminders off there
    ];
    const conv = (id: string, phone: string, inbound: string, x: Record<string, unknown> = {}) => ({ id, tenant_id: T, phone, platform: "whatsapp", name: "Priya Shah", channel_id: "ch2", last_inbound_at: inbound, ...x });
    h.m.tables.wa_conversations = [
      conv("cv1", "919876500911", ago(180)), conv("cv4", "919876500914", ago(30 * 60)), conv("cv5", "919876500915", ago(60)),
      { ...conv("cvx", "919876500917", ago(60)), tenant_id: O },
    ];
    h.optedOutPhones = new Set(["919876500915"]);
  };

  it("sends one reminder with the pay link, from the number the customer used, and shows it in the chat", async () => {
    orders();
    const r = await drainUnpaidReminders(NOW);
    expect(r).toEqual({ sent: 1, skipped: 2 });                // u4 outside window, u5 opted out
    expect(h.sent).toEqual([{ phone: "919876500911", channel: "ch2", body: expect.stringContaining("https://rzp.io/u1-order") }]);
    expect(h.sent[0].body).toMatch(/^Hi Priya, your order u1-order for ₹2,499\.00 is still waiting for payment/);
    expect(h.logged).toEqual([{ conversationId: "cv1", body: h.sent[0].body }]);
    // Once per order, even if it's still unpaid on the next run.
    expect(await drainUnpaidReminders(NOW)).toEqual({ sent: 0, skipped: 0 });
    const reminded = h.m.tables.wa_orders.filter(o => o.unpaid_reminded_at).map(o => o.id).sort();
    expect(reminded).toEqual(["u1-order", "u4-order", "u5-order"]);
    // An hour on, the newer order is due too; it has no chat, so it is skipped, not sent.
    expect(await drainUnpaidReminders(NOW + 60 * 60_000)).toEqual({ sent: 0, skipped: 1 });
    expect(h.sent).toHaveLength(1);
  });

  it("two runs at the same moment still send only one reminder", async () => {
    orders();
    const [a, b] = await Promise.all([drainUnpaidReminders(NOW), drainUnpaidReminders(NOW)]);
    expect(a.sent + b.sent).toBe(1);
    expect(h.sent).toHaveLength(1);
  });

  it("does nothing while switched off", async () => {
    orders();
    h.m.tables.wa_settings = [{ tenant_id: T, key: WORK_SETTINGS_KEY, value: {} }];
    expect(await drainUnpaidReminders(NOW)).toEqual({ sent: 0, skipped: 0 });
    expect(h.sent).toHaveLength(0);
  });

  it("writes a plain message without a name when there isn't one", () => {
    expect(unpaidMessage({ shortId: "abc", amount: "₹10", url: "https://x" })).toMatch(/^Your order abc for ₹10 /);
  });
});

describe("API routes", () => {
  const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body) });

  it("need a signed-in teammate", async () => {
    who.ctx = null;
    const today = await import("../../app/api/admin/today/route");
    expect((await today.GET()).status).toBe(401);
    const tasks = await import("../../app/api/admin/tasks/route");
    expect((await tasks.POST(post("/api/admin/tasks", { title: "x" }))).status).toBe(401);
  });

  it("let only an admin change who gets emailed and whether customers are reminded", async () => {
    const route = await import("../../app/api/admin/today/settings/route");
    who.ctx = { v: ben, myId: "u2" };
    expect((await route.POST(post("/api/admin/today/settings", { alertEmails: true }))).status).toBe(403);
    expect(h.settings[`${T}|${WORK_SETTINGS_KEY}`]).toBeUndefined();
    who.ctx = { v: admin, myId: "u1" };
    const r = await route.POST(post("/api/admin/today/settings", { alertEmails: true, replyTargetMinutes: 5, unpaidReminder: { enabled: true } }));
    expect(r.status).toBe(200);
    expect(h.settings[`${T}|${WORK_SETTINGS_KEY}`]).toMatchObject({ alertEmails: true, replyTargetMinutes: 5, unpaidReminder: { enabled: true, afterMinutes: 60 } });
  });

  it("return Today with the team, and add a task tied to a customer", async () => {
    who.ctx = { v: admin, myId: "u1" };
    const today = await import("../../app/api/admin/today/route");
    const j = await (await today.GET()).json();
    expect(j.items.length).toBeGreaterThan(0);
    expect(j.team.map((t: { name: string }) => t.name)).toEqual(["Asha", "Ben", "Lea"]);   // active teammates of this workspace only
    const tasks = await import("../../app/api/admin/tasks/route");
    const made = await (await tasks.POST(post("/api/admin/tasks", { title: "Share menu", contactId: "k2", assigneeId: "u2" }))).json();
    expect(made.task).toMatchObject({ title: "Share menu", contactName: "Meera", assigneeName: "Ben" });
    const cw = await import("../../app/api/admin/customer-work/route");
    const w = await (await cw.GET(new Request("http://x/api/admin/customer-work?contactId=k2"))).json();
    expect(w.contact).toMatchObject({ id: "k2", ownerId: null });
    expect(w.tasks.map((t: { title: string }) => t.title)).toEqual(["Share menu"]);
    expect((await cw.POST(post("/api/admin/customer-work", { contactId: "k2" }))).status).toBe(400);
  });
});
