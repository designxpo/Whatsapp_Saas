import { describe, it, expect, vi, beforeEach } from "vitest";

// The flow "Book table" step: every option shown comes from Mezvaan, and the
// booking is confirmed only when Mezvaan returns a code.

let slots: { start: string; label: string }[] = [];
let bookResult: unknown = null;
const booked: unknown[] = [];

vi.mock("@/lib/mezmitra", async (importOriginal) => {
  const real = await importOriginal<typeof import("../mezmitra")>();
  return {
    ...real,
    outlets: async () => ({ ok: true, data: { outlets: [{ id: "o1", name: "Courtyard", address: null, city: null, phone: "0731000000", timezone: "Asia/Kolkata", opening_hours: {}, online_booking: { enabled: true, max_party: 4, days_ahead: 30 } }] } }),
    availability: async () => ({ ok: true, data: { outlet_id: "o1", outlet_name: "Courtyard", date: "2026-11-07", party_size: 2, max_party: 4, reason: null, slots } }),
    book: async (...args: unknown[]) => { booked.push(args[2]); return bookResult; },
  };
});
vi.mock("@/lib/restaurant-tools", () => ({ restaurantLink: async () => ({ key: "mzk_test", defaultOutletId: null }) }));

import { continueTableBooking, startTableBooking, type BookTableIO, type BookTableState } from "../flow-booktable";

function io(kind: BookTableIO["kind"] = "whatsapp") {
  const out = { texts: [] as string[], lists: [] as { body: string; rows: { id: string; title: string }[] }[], state: null as BookTableState | null };
  const handle: BookTableIO = {
    kind, phone: kind === "whatsapp" ? "919876543210" : "ig-123", contactName: "Asha",
    text: async (b) => { out.texts.push(b); },
    list: async (body, _bt, rows) => { out.lists.push({ body, rows }); },
    save: async (s) => { out.state = s as unknown as BookTableState; },
  };
  return { handle, out };
}

beforeEach(() => {
  slots = [{ start: "2026-11-07T14:00:00.000Z", label: "7:30 pm" }, { start: "2026-11-07T14:30:00.000Z", label: "8:00 pm" }];
  bookResult = null;
  booked.length = 0;
});

describe("Book table flow step", () => {
  it("walks guests → day → offered times → booked, with the WhatsApp sender's number", async () => {
    const { handle, out } = io();
    expect((await startTableBooking("t1", handle, {})).kind).toBe("waiting");
    expect(out.lists[0].rows).toHaveLength(4);   // max_party 4
    expect((await continueTableBooking("t1", handle, out.state!, "p2")).kind).toBe("waiting");
    expect(out.state!.step).toBe("day");
    const day = out.state!.days![0];
    expect((await continueTableBooking("t1", handle, out.state!, day)).kind).toBe("waiting");
    expect(out.lists.at(-1)!.rows.map(r => r.title)).toEqual(["7:30 pm", "8:00 pm"]);
    bookResult = { ok: true, data: { id: "r1", ref: "BK7Q4M2X", outlet_id: "o1", outlet_name: "Courtyard", slot_start: slots[1].start, date: "2026-11-07", time: "8:00 pm", party_size: 2, status: "booked" } };
    const done = await continueTableBooking("t1", handle, out.state!, "s1");
    expect(done).toEqual({ kind: "booked", ref: "BK7Q4M2X" });
    expect(booked[0]).toMatchObject({ slotStart: slots[1].start, partySize: 2, phone: "+919876543210", guestName: "Asha" });
    expect(out.texts.at(-1)).toContain("BK7Q4M2X");
  });

  it("sends bigger parties to the phone instead of booking", async () => {
    const { handle, out } = io();
    await startTableBooking("t1", handle, {});
    expect((await continueTableBooking("t1", handle, out.state!, "9")).kind).toBe("ended");
    expect(out.texts.at(-1)).toMatch(/more than 4 guests/);
  });

  it("re-offers days when the picked time was just taken, and never says booked", async () => {
    const { handle, out } = io();
    const state: BookTableState = { step: "slot", outletId: "o1", party: 2, date: "2026-11-07", slots: { s0: slots[0].start } };
    bookResult = { ok: false, status: 409, code: "slot_unavailable", message: "taken" };
    expect((await continueTableBooking("t1", handle, state, "s0")).kind).toBe("waiting");
    expect(out.lists.at(-1)!.body).toMatch(/just taken/);
    expect(out.texts.join(" ")).not.toMatch(/Booked/);
  });

  it("asks for a number off WhatsApp before booking", async () => {
    const { handle, out } = io("instagram");
    const state: BookTableState = { step: "slot", outletId: "o1", party: 2, date: "2026-11-07", slots: { s0: slots[0].start } };
    expect((await continueTableBooking("t1", handle, state, "s0")).kind).toBe("waiting");
    expect(out.state!.step).toBe("phone");
    expect(booked).toHaveLength(0);
    bookResult = { ok: true, data: { id: "r2", ref: "BKAAAA22", outlet_id: "o1", outlet_name: "Courtyard", slot_start: slots[0].start, date: "2026-11-07", time: "7:30 pm", party_size: 2, status: "booked" } };
    expect((await continueTableBooking("t1", handle, out.state!, "98111 22233")).kind).toBe("booked");
    expect(booked[0]).toMatchObject({ phone: "+919811122233", channel: "instagram" });
  });

  it("lets anything that is not an answer go to the AI", async () => {
    const { handle } = io();
    expect((await continueTableBooking("t1", handle, { step: "party", outletId: "o1" }, "do you have parking?")).kind).toBe("not_mine");
    expect((await continueTableBooking("t1", handle, { step: "slot", outletId: "o1", party: 2, slots: { s0: slots[0].start } }, "s7")).kind).toBe("not_mine");
  });
});
