// Phase 6a: bookings kept in Talko — services and staff, no double-booking a
// staff member, status rules, team scoping, deposits as orders with pay links,
// bookings arriving from Cal.com / Calendly (through the real ingest), and one
// reminder per booking. Synthetic people and numbers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({
  m: null as unknown as MemDb,
  sent: [] as { phone: string; body: string }[],
  templates: [] as { phone: string; name: string; params: string[] }[],
  logged: [] as string[],
  payLink: true as boolean,
  optedOut: new Set<string>(),
  tpls: [] as { name: string; language: string; status: string; components: { type: string; text: string }[] }[],
}));

vi.mock("../supabase", () => ({ db: () => h.m.client }));
vi.mock("../tenantdb", () => ({
  tdb: (t: string) => ({
    from: (tb: string) => {
      const b = h.m.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert, ups = b.upsert;
      const stamp = (p: unknown) => (Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      b.insert = (p: unknown) => ins(stamp(p));
      b.upsert = (p: unknown, o?: unknown) => ups(stamp(p), o);
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  }),
}));
vi.mock("../store", async orig => ({
  ...(await orig<typeof import("../store")>()),
  isOptedOutStrict: async (p: string) => h.optedOut.has(p),
  appendConvMessage: async (p: { body: string }) => { h.logged.push(p.body); return { id: "m", createdAt: "" }; },
}));
vi.mock("../integrations", () => ({ createPaymentLink: async () => (h.payLink ? { id: "plink_d", url: "https://rzp.io/l/dep" } : null) }));
vi.mock("../channels", () => ({ listChannels: async () => [{ id: "ch1", kind: "whatsapp", isDefault: true }], isLiveChannel: () => true }));
vi.mock("../whatsapp", () => ({
  sendText: async (phone: string, body: string) => { h.sent.push({ phone, body }); return { id: `wamid.${h.sent.length}` }; },
  sendTemplateSingle: async (phone: string, name: string, _l: string, params: string[]) => { h.templates.push({ phone, name, params }); return { id: "wamid.t" }; },
  fetchTemplates: async () => h.tpls,
  bodyParamCount: (t: { components: { type: string; text: string }[] }) => (t.components.find(c => c.type === "BODY")?.text.match(/\{\{\d+\}\}/g) ?? []).length,
}));
vi.mock("../feature-guard", () => ({ accountCanSend: async () => true }));
vi.mock("../apirules", () => ({ processEvent: async () => [] }));
vi.mock("../autosend", () => ({ fireTrigger: async () => false }));

import { createBooking, updateBooking, listBookings, requestDeposit, recordExternalBooking, drainBookingReminders, saveService, saveStaff, normalizeBookingSettings, BOOKING_SETTINGS_KEY, reminderText } from "../bookings";
import { ingestEvents } from "../inbound/ingest";
import { calcomProvider } from "../inbound/connectors/calcom";
import { buildToday } from "../today";
import type { WorkViewer } from "../tasks";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-11-06T06:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();

const admin: WorkViewer = { user: { email: "asha@biz.test", name: "Asha", role: "admin", tenantId: T }, tenantId: T, allowed: null, canManage: true };
const ravi: WorkViewer = { user: { email: "ravi@biz.test", name: "Ravi", role: "member", tenantId: T }, tenantId: T, allowed: null, canManage: false };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  h.m = memdb({ wa_booking_services: [["tenant_id", "name"]], wa_booking_staff: [["tenant_id", "name"]], wa_bookings: [["tenant_id", "source", "external_ref"]], wa_settings: [["tenant_id", "key"]] });
  h.sent = []; h.templates = []; h.logged = []; h.payLink = true; h.optedOut = new Set(); h.tpls = [];
  const t = h.m.tables;
  t.wa_users = [{ id: "u1", tenant_id: T, name: "Asha", email: "asha@biz.test", active: true }, { id: "u2", tenant_id: T, name: "Ravi", email: "ravi@biz.test", active: true }, { id: "ux", tenant_id: O, name: "X", email: "x@o.test", active: true }];
  t.wa_booking_services = [
    { id: "svc-cut", tenant_id: T, name: "Haircut", duration_minutes: 45, price_cents: 50000, deposit_cents: 10000, active: true },
    { id: "svc-x", tenant_id: O, name: "Other", duration_minutes: 30, price_cents: 0, deposit_cents: 0, active: true },
  ];
  t.wa_booking_staff = [
    { id: "st-meera", tenant_id: T, name: "Meera", user_id: "u1", active: true },
    { id: "st-ravi", tenant_id: T, name: "Ravi", user_id: "u2", active: true },
    { id: "st-x", tenant_id: O, name: "X", user_id: null, active: true },
  ];
});
afterEach(() => vi.useRealTimers());

describe("setup", () => {
  it("keeps reminders off by default and validates services and staff", async () => {
    expect(normalizeBookingSettings(undefined).reminder).toEqual({ enabled: false, hoursBefore: 3, template: null });
    expect(normalizeBookingSettings({ reminder: { enabled: true, hoursBefore: 99, template: { name: "appt" } } }).reminder).toEqual({ enabled: true, hoursBefore: 48, template: { name: "appt", language: "en" } });
    expect((await saveService(T, { name: "Colour", durationMinutes: 90, priceCents: 1000, depositCents: 5000 })).error).toMatch(/more than the price/);
    expect((await saveService(T, { name: "Haircut" })).status).toBe(409);
    expect((await saveService(T, { name: "x", durationMinutes: 2 })).status).toBe(400);
    expect((await saveStaff(T, { name: "New", userId: "ux" })).status).toBe(400);   // another business's login
    expect(await saveStaff(T, { name: "New", userId: "u2" })).toEqual({ ok: true });
  });
});

describe("making and changing bookings", () => {
  it("uses the service's length and deposit, and never double-books a staff member", async () => {
    const a = await createBooking(admin, { phone: "+91 98765 00001", name: "Kiran", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(60) });
    expect(a.booking).toMatchObject({ title: "Haircut", startsAt: at(60), endsAt: at(105), status: "booked", depositCents: 10000, staffName: "Meera", deposit: "none" });
    expect((await createBooking(admin, { phone: "919876500002", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(90) })).status).toBe(409);
    expect((await createBooking(admin, { phone: "919876500002", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(105) })).booking).toBeTruthy();   // back-to-back is fine
    expect((await createBooking(admin, { phone: "919876500002", serviceId: "svc-cut", staffId: "st-ravi", startsAt: at(60) })).booking).toBeTruthy();    // someone else is free
    expect((await createBooking(admin, { phone: "919876500002", staffId: "st-x", startsAt: at(60) })).status).toBe(400);
    expect((await createBooking(admin, { phone: "123", startsAt: at(60) })).status).toBe(400);
  });

  it("moves status forward only, and only once the time has come for attended / no-show", async () => {
    const { booking } = await createBooking(admin, { phone: "919876500001", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(60) });
    const id = booking!.id;
    expect((await updateBooking(admin, "u1", id, { status: "completed" })).error).toMatch(/hasn't started/);
    expect((await updateBooking(admin, "u1", id, { status: "confirmed" })).booking!.status).toBe("confirmed");
    expect((await updateBooking(admin, "u1", id, { status: "booked" })).status).toBe(409);
    vi.setSystemTime(NOW + 70 * 60_000);
    expect((await updateBooking(admin, "u1", id, { status: "no_show" })).booking!.status).toBe("no_show");
    expect((await updateBooking(admin, "u1", id, { status: "cancelled" })).status).toBe(409);
  });

  it("refuses moving a booking onto someone's taken slot, and resets its reminder when moved", async () => {
    const a = (await createBooking(admin, { phone: "919876500001", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(60) })).booking!;
    const b = (await createBooking(admin, { phone: "919876500002", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(200) })).booking!;
    expect((await updateBooking(admin, "u1", b.id, { startsAt: at(80) })).status).toBe(409);
    h.m.tables.wa_bookings.find(x => x.id === a.id)!.reminder_sent_at = at(-5);
    const moved = await updateBooking(admin, "u1", a.id, { startsAt: at(300) });
    expect(moved.booking).toMatchObject({ startsAt: at(300), endsAt: at(345), reminderSentAt: null });
    expect((await updateBooking(admin, "u1", a.id, { status: "cancelled", cancelReason: "Customer called" })).booking!.cancelReason).toBe("Customer called");
  });

  it("shows a team member only the bookings of the staff linked to them", async () => {
    await createBooking(admin, { phone: "919876500001", staffId: "st-meera", startsAt: at(60) });
    const mine = (await createBooking(admin, { phone: "919876500002", staffId: "st-ravi", startsAt: at(60) })).booking!;
    const seen = await listBookings(ravi, "u2", at(0), at(24 * 60));
    expect(seen.bookings.map(b => b.id)).toEqual([mine.id]);
    const other = h.m.tables.wa_bookings.find(b => b.staff_id === "st-meera")!;
    expect((await updateBooking(ravi, "u2", other.id as string, { status: "confirmed" })).status).toBe(404);
    expect((await listBookings(admin, "u1", at(0), at(24 * 60))).bookings).toHaveLength(2);
  });
});

describe("deposits", () => {
  it("creates an order with a pay link, sends it in the chat when allowed, and shows when it's paid", async () => {
    h.m.tables.wa_conversations = [{ id: "cv1", tenant_id: T, phone: "919876500001", platform: "whatsapp", channel_id: "ch1", last_inbound_at: at(-30) }];
    const b = (await createBooking(admin, { phone: "919876500001", serviceId: "svc-cut", staffId: "st-meera", startsAt: at(24 * 60) })).booking!;
    const r = await requestDeposit(admin, "u1", b.id);
    expect(r).toEqual({ url: "https://rzp.io/l/dep", sent: true });
    expect(h.sent[0].body).toMatch(/please pay the deposit here: https:\/\/rzp\.io\/l\/dep/);
    const order = h.m.tables.wa_orders[0];
    expect(order).toMatchObject({ tenant_id: T, total_cents: 10000, status: "pending", payment_url: "https://rzp.io/l/dep" });
    expect((await requestDeposit(admin, "u1", b.id)).status).toBe(409);
    order.status = "paid";
    expect((await listBookings(admin, "u1", at(0), at(2 * 24 * 60))).bookings[0].deposit).toBe("paid");
  });

  it("says what's missing: no deposit on the service, or no payment provider", async () => {
    const free = (await createBooking(admin, { phone: "919876500001", startsAt: at(60) })).booking!;
    expect((await requestDeposit(admin, "u1", free.id)).status).toBe(400);
    h.payLink = false;
    const paid = (await createBooking(admin, { phone: "919876500001", serviceId: "svc-cut", startsAt: at(300) })).booking!;
    expect((await requestDeposit(admin, "u1", paid.id)).error).toMatch(/Connect a payment provider/);
    expect(h.m.tables.wa_orders[0].status).toBe("cancelled");
  });
});

describe("bookings from Cal.com and Calendly", () => {
  it("records a Cal.com booking through the real webhook ingest, once", async () => {
    const body = { triggerEvent: "BOOKING_CREATED", payload: { uid: "cal_1", title: "Consultation", startTime: at(120), endTime: at(150), responses: { name: { value: "Neha" }, attendeePhoneNumber: { value: "+919876500005" } }, attendees: [{ timeZone: "Asia/Kolkata" }] } };
    const events = calcomProvider.parse({ body, config: { defaultCountryCode: "91" } } as never);
    const integration = { id: "conn1", tenantId: T, kind: "calcom", config: {} } as never;
    await ingestEvents(integration, events);
    await ingestEvents(integration, events);   // Cal.com retrying the webhook
    expect(h.m.tables.wa_bookings).toEqual([expect.objectContaining({ tenant_id: T, source: "calcom", external_ref: "cal_1", phone: "919876500005", name: "Neha", title: "Consultation", starts_at: at(120), ends_at: at(150), status: "booked" })]);
  });

  it("moves a rescheduled Calendly booking and cancels a cancelled one", async () => {
    await recordExternalBooking(T, { source: "calendly", kind: "created", ref: "inv/1", phone: "919876500006", startsAt: at(60), endsAt: at(90), title: "Demo" });
    expect(await recordExternalBooking(T, { source: "calendly", kind: "rescheduled", ref: "inv/2", previousRef: "inv/1", phone: "919876500006", startsAt: at(240), endsAt: at(270) })).toBe("updated");
    expect(h.m.tables.wa_bookings).toHaveLength(1);
    expect(h.m.tables.wa_bookings[0]).toMatchObject({ external_ref: "inv/2", starts_at: at(240), status: "booked" });
    expect(await recordExternalBooking(T, { source: "calendly", kind: "cancelled", ref: "inv/2", phone: "919876500006", cancelReason: "Can't make it" })).toBe("cancelled");
    expect(h.m.tables.wa_bookings[0]).toMatchObject({ status: "cancelled", cancel_reason: "Can't make it" });
    // A Cal.com reschedule without the old reference moves the customer's next booking from Cal.com.
    await recordExternalBooking(T, { source: "calcom", kind: "created", ref: "a", phone: "919876500007", startsAt: at(60) });
    expect(await recordExternalBooking(T, { source: "calcom", kind: "rescheduled", ref: "b", phone: "919876500007", startsAt: at(500) })).toBe("updated");
    expect(h.m.tables.wa_bookings.filter(b => b.phone === "919876500007")).toEqual([expect.objectContaining({ external_ref: "b", starts_at: at(500) })]);
  });
});

describe("reminders", () => {
  const enable = (x: Record<string, unknown> = {}) => { h.m.tables.wa_settings = [{ tenant_id: T, key: BOOKING_SETTINGS_KEY, value: { reminder: { enabled: true, hoursBefore: 3, ...x } } }]; };
  const seed = () => {
    h.m.tables.wa_bookings = [
      { id: "b-in", tenant_id: T, phone: "919876500011", name: "Priya Shah", title: "Haircut", starts_at: at(120), ends_at: at(165), status: "confirmed", reminder_sent_at: null },
      { id: "b-out", tenant_id: T, phone: "919876500012", name: "", title: "Facial", starts_at: at(150), ends_at: at(210), status: "booked", reminder_sent_at: null },
      { id: "b-late", tenant_id: T, phone: "919876500013", name: "", title: "Spa", starts_at: at(600), ends_at: at(660), status: "booked", reminder_sent_at: null },
      { id: "b-cx", tenant_id: T, phone: "919876500014", name: "", title: "Spa", starts_at: at(60), ends_at: at(90), status: "cancelled", reminder_sent_at: null },
    ];
    h.m.tables.wa_conversations = [{ id: "cv-in", tenant_id: T, phone: "919876500011", platform: "whatsapp", last_inbound_at: at(-60) }];
  };

  it("sends one plain reminder inside the 24-hour window, and explains why others weren't sent", async () => {
    enable(); seed();
    expect(await drainBookingReminders(NOW)).toEqual({ sent: 1, skipped: 1 });
    expect(h.sent).toEqual([{ phone: "919876500011", body: reminderText({ name: "Priya Shah", title: "Haircut", startsAt: at(120) }) }]);
    expect(h.sent[0].body).toMatch(/^Hi Priya, a reminder of your Haircut on /);
    expect(h.logged).toHaveLength(1);
    const by = (id: string) => h.m.tables.wa_bookings.find(b => b.id === id)!;
    expect(by("b-out").reminder_detail).toMatch(/no reminder template/);
    expect(by("b-late").reminder_sent_at).toBeNull();      // too early
    expect(by("b-cx").reminder_sent_at).toBeNull();        // cancelled
    expect(await drainBookingReminders(NOW)).toEqual({ sent: 0, skipped: 0 });   // never twice
  });

  it("two runs at the same moment still send one reminder", async () => {
    enable(); seed();
    await Promise.all([drainBookingReminders(NOW), drainBookingReminders(NOW)]);
    expect(h.sent).toHaveLength(1);
  });

  it("uses an approved template outside the window, with name and time", async () => {
    enable({ template: { name: "appt_reminder", language: "en" } }); seed();
    h.tpls = [{ name: "appt_reminder", language: "en", status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}, see you on {{2}}." }] }];
    await drainBookingReminders(NOW);
    expect(h.templates).toEqual([{ phone: "919876500012", name: "appt_reminder", params: ["there", expect.stringMatching(/Fri|Thu|Sat|Sun|Mon|Tue|Wed/)] }]);
  });

  it("does nothing while reminders are off", async () => {
    seed();
    expect(await drainBookingReminders(NOW)).toEqual({ sent: 0, skipped: 0 });
  });
});

describe("Today", () => {
  it("asks to confirm upcoming bookings and to close ones that have ended", async () => {
    h.m.tables.wa_bookings = [
      { id: "up", tenant_id: T, phone: "919876500021", name: "Anil", title: "Haircut", starts_at: at(120), ends_at: at(165), status: "booked", staff_id: "st-meera" },
      { id: "done", tenant_id: T, phone: "919876500022", name: "", title: "Facial", starts_at: at(-300), ends_at: at(-240), status: "confirmed", staff_id: "st-ravi" },
      { id: "ok", tenant_id: T, phone: "919876500023", name: "", title: "Facial", starts_at: at(60), ends_at: at(90), status: "confirmed", staff_id: "st-ravi" },
    ];
    const r = await buildToday(admin, "u1", NOW);
    const b = r.items.filter(i => i.kind === "booking");
    expect(b.map(i => [i.key, i.action])).toEqual([["booking:done:close", "Mark it completed or a no-show"], ["booking:up:confirm", "Confirm the booking"]]);
    expect(b[0]).toMatchObject({ overdue: true, person: "Ravi", open: { tab: "bookings" } });
  });
});
