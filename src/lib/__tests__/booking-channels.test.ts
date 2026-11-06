// Bookings from every chat channel and from Mezvaan, and the AI booking in an
// ordinary conversation:
//  - a booking made on Instagram / Messenger / web chat is kept, tied to its chat
//  - a calendar's own webhook for the same booking doesn't make a second one
//  - the AI's appointment tools only offer real free times, need consent to act,
//    and say "Booked" only when the calendar booked it
//  - Mezvaan reservations (events and the AI's book_table / cancel_booking) land
//    in Bookings once, matched by booking code
//  - WhatsApp reminders only go to WhatsApp bookings
// Synthetic people, numbers and codes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({
  m: null as unknown as MemDb,
  sent: [] as { phone: string; body: string }[],
  slots: null as null | { provider: "google_calendar" | "calcom"; slots: { id: string; iso: string; label: string }[] },
  booked: [] as Record<string, unknown>[],
  calcom: [] as Record<string, unknown>[],
  bookOk: true,
  mezBook: null as null | Record<string, unknown>,
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
vi.mock("../store", async orig => ({
  ...(await orig<typeof import("../store")>()),
  isOptedOutStrict: async () => false,
  appendConvMessage: async () => ({ id: "m", createdAt: "" }),
}));
vi.mock("../channels", () => ({ listChannels: async () => [{ id: "ch1", kind: "whatsapp", isDefault: true }], isLiveChannel: () => true }));
vi.mock("../whatsapp", () => ({
  sendText: async (phone: string, body: string) => { h.sent.push({ phone, body }); return { id: "wamid.1" }; },
  sendTemplateSingle: async () => ({ id: "wamid.t" }), fetchTemplates: async () => [], bodyParamCount: () => 0,
}));
vi.mock("../feature-guard", () => ({ accountCanSend: async () => true }));
vi.mock("../integrations", () => ({
  createPaymentLink: async () => null,
  scheduleSlots: async () => h.slots,
  scheduleBook: async (_t: string, p: Record<string, unknown>) => { h.booked.push(p); return h.bookOk; },
  calcomBook: async (_t: string, p: Record<string, unknown>) => { h.calcom.push(p); return h.bookOk; },
}));
vi.mock("../mezmitra", async orig => ({
  ...(await orig<typeof import("../mezmitra")>()),
  outlets: async () => ({ ok: true, data: { outlets: [{ id: "o1", name: "Spice Route", address: null, city: null, phone: null, timezone: "Asia/Kolkata", opening_hours: null, online_booking: { enabled: true, max_party: 10, days_ahead: 30 } }] } }),
  availability: async () => ({ ok: true, data: { reason: null, max_party: 10, slots: [{ start: "2026-11-07T14:30:00.000Z", label: "8:00 pm" }] } }),
  book: async () => ({ ok: true, data: h.mezBook }),
  cancel: async () => ({ ok: true, data: { outlet_name: "Spice Route", date: "2026-11-07", time: "8:00 pm" } }),
}));

import { recordExternalBooking, recordMezvaanBooking, listBookings, drainBookingReminders, BOOKING_SETTINGS_KEY } from "../bookings";
import { appointmentTools, executeAppointmentTool, pickSlot, APPOINTMENT_FNS } from "../appointment-tools";
import { executeRestaurantTool } from "../restaurant-tools";
import { processEvent } from "../apirules";
import type { WorkViewer } from "../tasks";

const T = "10000000-0000-0000-0000-000000000001";
const NOW = Date.parse("2026-11-06T06:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const admin: WorkViewer = { user: { email: "asha@biz.test", name: "Asha", role: "admin", tenantId: T }, tenantId: T, allowed: null, canManage: true };
const SLOTS = [{ id: "s0", iso: at(24 * 60), label: "Sat 7 Nov, 11:30 AM" }, { id: "s1", iso: at(26 * 60), label: "Sat 7 Nov, 1:30 PM" }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  h.m = memdb({ wa_bookings: [["tenant_id", "source", "external_ref"]] });
  h.sent = []; h.booked = []; h.calcom = []; h.bookOk = true; h.slots = { provider: "google_calendar", slots: SLOTS };
  h.mezBook = { id: "mb1", ref: "BK7Q4M2X", outlet_id: "o1", outlet_name: "Spice Route", slot_start: "2026-11-07T14:30:00.000Z", date: "2026-11-07", time: "8:00 pm", party_size: 4, status: "booked" };
  h.m.tables.wa_conversations = [{ id: "5b0c7d1e-0000-4000-8000-000000000001", tenant_id: T, phone: "1789000111222", platform: "instagram" }];
});
afterEach(() => vi.useRealTimers());

describe("bookings from any chat channel", () => {
  it("keeps an Instagram booking tied to its chat, and opens that chat from Bookings", async () => {
    expect(await recordExternalBooking(T, { source: "google_calendar", kind: "created", ref: "evt1", phone: "1789000111222", startsAt: at(60), endsAt: at(90), channel: "instagram", conversationId: "5b0c7d1e-0000-4000-8000-000000000001", name: "Neha" })).toBe("created");
    const [b] = (await listBookings(admin, "u1", at(0), at(24 * 60))).bookings;
    expect(b).toMatchObject({ channel: "instagram", chatKey: "1789000111222", source: "google_calendar", name: "Neha" });
  });

  it("joins the calendar's later webhook to the booking the chat already saved", async () => {
    await recordExternalBooking(T, { source: "calcom", kind: "created", ref: null, phone: "919876500051", startsAt: at(120), endsAt: at(150) });
    expect(await recordExternalBooking(T, { source: "calcom", kind: "created", ref: "cal_uid_9", phone: "919876500051", startsAt: at(120), endsAt: at(150) })).toBe("updated");
    expect(h.m.tables.wa_bookings).toEqual([expect.objectContaining({ external_ref: "cal_uid_9", status: "booked" })]);
    expect(await recordExternalBooking(T, { source: "calcom", kind: "cancelled", ref: "cal_uid_9", phone: "" })).toBe("cancelled");
  });

  it("sends WhatsApp reminders only for WhatsApp bookings, and says why the others weren't", async () => {
    h.m.tables.wa_settings = [{ tenant_id: T, key: BOOKING_SETTINGS_KEY, value: { reminder: { enabled: true, hoursBefore: 3 } } }];
    h.m.tables.wa_bookings = [
      { id: "b-ig", tenant_id: T, phone: "1789000111222", name: "", title: "Consult", starts_at: at(60), ends_at: at(90), status: "booked", channel: "instagram", reminder_sent_at: null },
      { id: "b-wa", tenant_id: T, phone: "919876500052", name: "", title: "Consult", starts_at: at(90), ends_at: at(120), status: "booked", channel: "whatsapp", reminder_sent_at: null },
    ];
    h.m.tables.wa_conversations.push({ id: "cv-wa", tenant_id: T, phone: "919876500052", platform: "whatsapp", last_inbound_at: at(-30) });
    expect(await drainBookingReminders(NOW)).toEqual({ sent: 1, skipped: 1 });
    expect(h.sent.map(s => s.phone)).toEqual(["919876500052"]);
    expect(h.m.tables.wa_bookings.find(b => b.id === "b-ig")!.reminder_detail).toMatch(/Booked on Instagram/);
  });
});

describe("the AI booking in an ordinary chat", () => {
  const ctx = { tenantId: T, platform: "instagram" as const, canAct: true, contactKey: "1789000111222", conversationId: "5b0c7d1e-0000-4000-8000-000000000001" };

  it("offers a times tool always, and a booking tool only where it may act (Cal.com needs an email)", () => {
    expect(appointmentTools("whatsapp", false, "google_calendar").map(t => t.name)).toEqual([APPOINTMENT_FNS.times]);
    const g = appointmentTools("instagram", true, "google_calendar").find(t => t.name === APPOINTMENT_FNS.book)!;
    expect(g.required).toEqual(["time", "name"]);
    expect(appointmentTools("whatsapp", true, "calcom").find(t => t.name === APPOINTMENT_FNS.book)!.required).toEqual(["time", "name", "email"]);
  });

  it("lists only the calendar's free times, and matches the customer's pick to one of them", async () => {
    expect((await executeAppointmentTool(APPOINTMENT_FNS.times, {}, ctx, "google_calendar")).status).toBe("Free times: Sat 7 Nov, 11:30 AM; Sat 7 Nov, 1:30 PM.");
    expect(pickSlot("sat 7 nov 1:30 pm", SLOTS)?.id).toBe("s1");
    expect(pickSlot("3am", SLOTS)).toBeNull();
  });

  it("books an offered time for the chat it came from, and refuses anything else", async () => {
    const r = await executeAppointmentTool(APPOINTMENT_FNS.book, { time: "Sat 7 Nov, 1:30 PM", name: "Neha" }, ctx, "google_calendar");
    expect(r.status).toMatch(/^Booked: Sat 7 Nov, 1:30 PM, under Neha/);
    expect(h.booked[0]).toMatchObject({ startIso: SLOTS[1].iso, name: "Neha", who: { contactKey: "1789000111222", channel: "instagram", conversationId: ctx.conversationId } });
    expect((await executeAppointmentTool(APPOINTMENT_FNS.book, { time: "midnight", name: "Neha" }, ctx, "google_calendar")).status).toMatch(/isn't free/);
    expect((await executeAppointmentTool(APPOINTMENT_FNS.book, { time: SLOTS[0].label, name: "" }, ctx, "google_calendar")).status).toMatch(/Ask the customer for the name/);
    expect((await executeAppointmentTool(APPOINTMENT_FNS.book, { time: SLOTS[0].label, name: "Neha" }, { ...ctx, canAct: false }, "google_calendar")).status).toMatch(/can't be booked from here/);
    h.bookOk = false;
    expect((await executeAppointmentTool(APPOINTMENT_FNS.book, { time: SLOTS[0].label, name: "Neha" }, ctx, "google_calendar")).status).toMatch(/^Not booked/);
    expect(h.booked).toHaveLength(2);
  });

  it("asks for the email Cal.com needs, then books there with the customer's WhatsApp number", async () => {
    const wa = { ...ctx, platform: "whatsapp" as const, contactKey: "919876500053", conversationId: null };
    h.slots = { provider: "calcom", slots: SLOTS };
    expect((await executeAppointmentTool(APPOINTMENT_FNS.book, { time: SLOTS[0].label, name: "Ravi" }, wa, "calcom")).status).toMatch(/email/);
    expect((await executeAppointmentTool(APPOINTMENT_FNS.book, { time: SLOTS[0].label, name: "Ravi", email: "ravi@example.com" }, wa, "calcom")).status).toMatch(/^Booked/);
    expect(h.calcom[0]).toMatchObject({ email: "ravi@example.com", who: { phone: "919876500053", channel: "whatsapp" } });
  });

  it("says it couldn't check when the calendar is unreachable", async () => {
    h.slots = null;
    expect((await executeAppointmentTool(APPOINTMENT_FNS.times, {}, ctx, "google_calendar")).status).toMatch(/couldn't be checked/);
  });
});

describe("Mezvaan table reservations", () => {
  it("records the AI's book_table booking from any channel, and Mezvaan's event for it doesn't duplicate it", async () => {
    const r = await executeRestaurantTool("book_table", { date: "2026-11-07", time: "8:00 pm", party_size: "4", name: "Kabir", phone: "98765 00061" },
      { tenantId: T, platform: "instagram", canAct: true, phone: null, conversationId: "5b0c7d1e-0000-4000-8000-000000000001" }, { key: "k", defaultOutletId: "o1" });
    expect(r.status).toMatch(/^Booked\. Code BK7Q4M2X/);
    expect(h.m.tables.wa_bookings).toEqual([expect.objectContaining({ source: "mezvaan", external_ref: "BK7Q4M2X", phone: "919876500061", channel: "instagram", title: "Table for 4 — Spice Route", starts_at: "2026-11-07T14:30:00.000Z", ends_at: "2026-11-07T16:00:00.000Z" })]);
    await processEvent({ event: "mezmitra.reservation.created", phone: "919876500061", name: "Kabir", payload: { booking_ref: "BK7Q4M2X", slot_start: "2026-11-07T14:30:00.000Z", party_size: 4, outlet_name: "Spice Route" } }, T);
    expect(h.m.tables.wa_bookings).toHaveLength(1);
  });

  it("records staff and WhatsApp reservations from Mezvaan's events, and cancels them", async () => {
    await processEvent({ event: "mezmitra.reservation.created", phone: "919876500062", name: "Meera", payload: { booking_ref: "BKSTAFF01", slot_start: "2026-11-08T13:00:00.000Z", party_size: 2, outlet_name: "Spice Route" } }, T);
    expect(h.m.tables.wa_bookings).toEqual([expect.objectContaining({ source: "mezvaan", external_ref: "BKSTAFF01", channel: "whatsapp", status: "booked", title: "Table for 2 — Spice Route" })]);
    await processEvent({ event: "mezmitra.reservation.cancelled", phone: "919876500062", payload: { booking_ref: "BKSTAFF01", slot_start: "2026-11-08T13:00:00.000Z" } }, T);
    expect(h.m.tables.wa_bookings[0]).toMatchObject({ status: "cancelled", cancel_reason: "Cancelled in Mezvaan" });
    await processEvent({ event: "mezmitra.reservation.created", phone: "919876500063", payload: { booking_ref: "BKX" }, dryRun: true }, T);
    expect(h.m.tables.wa_bookings).toHaveLength(1);    // a test run records nothing
  });

  it("cancelling with the AI on WhatsApp cancels it in Bookings too", async () => {
    await recordMezvaanBooking(T, { kind: "created", ref: "BK7Q4M2X", phone: "919876500064", slotStart: "2026-11-07T14:30:00.000Z", partySize: 4, outletName: "Spice Route" });
    await executeRestaurantTool("cancel_booking", { booking_code: "BK7Q4M2X" }, { tenantId: T, platform: "whatsapp", canAct: true, phone: "919876500064", conversationId: null }, { key: "k", defaultOutletId: "o1" });
    expect(h.m.tables.wa_bookings[0].status).toBe("cancelled");
  });
});
