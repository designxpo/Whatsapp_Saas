import { describe, it, expect, vi, beforeEach } from "vitest";

// The AI's restaurant tools must never let a booking, a time or a price come
// from anywhere but Mezmitra. Mezmitra is mocked here; the pure helpers
// (time matching, outlet picking) stay real.

const calls: { fn: string; args: unknown[] }[] = [];
let bookResult: unknown = null;

vi.mock("@/lib/mezmitra", async (importOriginal) => {
  const real = await importOriginal<typeof import("../mezmitra")>();
  const rec = (fn: string, result: unknown) => async (...args: unknown[]) => { calls.push({ fn, args }); return result; };
  return {
    ...real,
    outlets: rec("outlets", { ok: true, data: { outlets: [{ id: "o1", name: "Courtyard", address: "MG Road", city: "Indore", phone: "0731000000", timezone: "Asia/Kolkata", opening_hours: { sat: [["19:00", "23:00"]] }, online_booking: { enabled: true, max_party: 6, days_ahead: 30 } }] } }),
    menu: rec("menu", { ok: true, data: { categories: [{ id: "c", name: "Starters", items: [
      { id: "i1", name: "Paneer Tikka", description: null, price_paise: 25000, is_veg: true, in_stock: true, available_now: true },
      { id: "i2", name: "Chicken Tikka", description: null, price_paise: 32000, is_veg: false, in_stock: false, available_now: false },
    ] }] } }),
    availability: rec("availability", { ok: true, data: { outlet_id: "o1", outlet_name: "Courtyard", date: "2026-11-07", party_size: 2, max_party: 6, reason: null, slots: [
      { start: "2026-11-07T14:00:00.000Z", label: "7:30 pm" },
      { start: "2026-11-07T14:30:00.000Z", label: "8:00 pm" },
    ] } }),
    book: async (...args: unknown[]) => { calls.push({ fn: "book", args }); return bookResult; },
    bookingsFor: rec("bookingsFor", { ok: true, data: { bookings: [] } }),
    cancel: rec("cancel", { ok: false, status: 404, code: "not_found", message: "Booking not found" }),
  };
});
vi.mock("@/lib/integrations", () => ({ mezmitraLink: async () => ({ integration: { active: true, config: {} }, key: "mzk_test" }) }));
vi.mock("@/lib/entitlements", () => ({ checkFeature: async () => ({ ok: true }) }));

import { executeRestaurantTool, restaurantTools, RESTAURANT_FNS } from "../restaurant-tools";

const link = { key: "mzk_test", defaultOutletId: null };
const wa = { tenantId: "t1", platform: "whatsapp" as const, phone: "919876543210", canAct: true };
const ig = { tenantId: "t1", platform: "instagram" as const, phone: null, canAct: true };

beforeEach(() => { calls.length = 0; bookResult = null; });

describe("restaurant tools", () => {
  it("offers lookups and cancelling only on WhatsApp, and asks for a phone elsewhere", () => {
    const waNames = restaurantTools("whatsapp", true).map(t => t.name);
    const igTools = restaurantTools("instagram", true);
    expect(waNames).toContain(RESTAURANT_FNS.cancel);
    expect(igTools.map(t => t.name)).not.toContain(RESTAURANT_FNS.cancel);
    expect(igTools.map(t => t.name)).not.toContain(RESTAURANT_FNS.mine);
    expect(igTools.find(t => t.name === RESTAURANT_FNS.book)?.required).toContain("phone");
  });

  it("never books or cancels from a draft, a test or a public comment reply", async () => {
    const draftTools = restaurantTools("whatsapp", false).map(t => t.name);
    expect(draftTools).toContain(RESTAURANT_FNS.menu);
    expect(draftTools).not.toContain(RESTAURANT_FNS.book);
    expect(draftTools).not.toContain(RESTAURANT_FNS.cancel);
    // Even if a model calls it anyway.
    bookResult = { ok: true, data: { id: "r9", ref: "BKZZZZ99", outlet_id: "o1", outlet_name: "Courtyard", slot_start: "x", date: "2026-11-07", time: "8:00 pm", party_size: 2, status: "booked" } };
    const r = await executeRestaurantTool(RESTAURANT_FNS.book, { date: "2026-11-07", time: "8:00 pm", party_size: 2, name: "Asha" }, { ...wa, canAct: false }, link);
    expect(r.status).not.toMatch(/^Booked/);
    expect(calls.some(c => c.fn === "book" || c.fn === "availability")).toBe(false);
  });

  it("reads prices and stock from the live menu", async () => {
    const r = await executeRestaurantTool(RESTAURANT_FNS.menu, { search: "tikka" }, wa, link);
    expect(r.status).toContain("Paneer Tikka — ₹250 (veg)");
    expect(r.status).toMatch(/Chicken Tikka — ₹320 \(non-veg\) — not available right now/);
  });

  it("books only a time Mezmitra offered, under the WhatsApp sender's own number", async () => {
    bookResult = { ok: true, data: { id: "r1", ref: "BK7Q4M2X", outlet_id: "o1", outlet_name: "Courtyard", slot_start: "2026-11-07T14:30:00.000Z", date: "2026-11-07", time: "8:00 pm", party_size: 2, status: "booked" } };
    const r = await executeRestaurantTool(RESTAURANT_FNS.book, { date: "2026-11-07", time: "8 pm", party_size: "2", name: "Asha", phone: "9000000000" }, wa, link);
    expect(r.status).toMatch(/^Booked\. Code BK7Q4M2X/);
    const book = calls.find(c => c.fn === "book")!;
    expect(book.args[2]).toMatchObject({ slotStart: "2026-11-07T14:30:00.000Z", partySize: 2, phone: "+919876543210", channel: "whatsapp" });
  });

  it("never books a time that was not offered", async () => {
    const r = await executeRestaurantTool(RESTAURANT_FNS.book, { date: "2026-11-07", time: "9:15 pm", party_size: 2, name: "Asha" }, wa, link);
    expect(calls.some(c => c.fn === "book")).toBe(false);
    expect(r.status).toMatch(/isn't free/);
    expect(r.status).toContain("7:30 pm, 8:00 pm");
  });

  it("does not claim a booking Mezmitra refused", async () => {
    bookResult = { ok: false, status: 409, code: "slot_unavailable", message: "That time is not available." };
    const r = await executeRestaurantTool(RESTAURANT_FNS.book, { date: "2026-11-07", time: "8:00 pm", party_size: 2, name: "Asha" }, wa, link);
    expect(r.status).not.toMatch(/^Booked/);
    expect(r.status).toMatch(/just taken/);
  });

  it("asks for a phone off WhatsApp, and uses the one the guest gave", async () => {
    const noPhone = await executeRestaurantTool(RESTAURANT_FNS.book, { date: "2026-11-07", time: "8:00 pm", party_size: 2, name: "Ravi" }, ig, link);
    expect(noPhone.status).toMatch(/mobile number/);
    expect(calls.some(c => c.fn === "book")).toBe(false);
    bookResult = { ok: true, data: { id: "r2", ref: "BKAAAA22", outlet_id: "o1", outlet_name: "Courtyard", slot_start: "x", date: "2026-11-07", time: "8:00 pm", party_size: 2, status: "booked" } };
    await executeRestaurantTool(RESTAURANT_FNS.book, { date: "2026-11-07", time: "8:00 pm", party_size: 2, name: "Ravi", phone: "98111 22233" }, ig, link);
    expect(calls.find(c => c.fn === "book")!.args[2]).toMatchObject({ phone: "+919811122233", channel: "instagram" });
  });

  it("refuses to look up or cancel bookings without a WhatsApp-verified number", async () => {
    const mine = await executeRestaurantTool(RESTAURANT_FNS.mine, {}, ig, link);
    const cancel = await executeRestaurantTool(RESTAURANT_FNS.cancel, { booking_code: "BK7Q4M2X" }, ig, link);
    expect(mine.status).toMatch(/only be looked up or cancelled on WhatsApp/);
    expect(cancel.status).toMatch(/only be looked up or cancelled on WhatsApp/);
    expect(calls.some(c => c.fn === "bookingsFor" || c.fn === "cancel")).toBe(false);
  });

  it("cancels with the sender's own number only", async () => {
    const r = await executeRestaurantTool(RESTAURANT_FNS.cancel, { booking_code: "bk7q4m2x" }, wa, link);
    expect(calls.find(c => c.fn === "cancel")!.args).toEqual(["mzk_test", "BK7Q4M2X", "+919876543210"]);
    expect(r.status).toMatch(/No upcoming booking BK7Q4M2X/);
  });
});
