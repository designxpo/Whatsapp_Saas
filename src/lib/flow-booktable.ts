import * as mez from "./mezmitra";
import { restaurantLink } from "./restaurant-tools";
import { matchSlot } from "./integrations";
import type { Platform } from "./channel-label";

// The flow "Book table" step: a fixed, AI-free booking conversation against a
// Mezmitra restaurant — outlet (if several) → number of guests → day → a free
// time → booked. Every option shown is one Mezmitra returned, and the booking
// is confirmed only when Mezmitra answers with a booking code. Nothing here is
// written by a model, so nothing here can be made up.

export interface BookTableIO {
  kind: Platform;
  // The sender's identity: a phone on WhatsApp (verified by WhatsApp), a contact id elsewhere.
  phone: string;
  contactName: string | null;
  text(body: string): Promise<unknown>;
  list(body: string, buttonText: string, rows: { id: string; title: string }[]): Promise<unknown>;
  save(state: Record<string, unknown>): Promise<void>;
}

type Step = "outlet" | "party" | "day" | "slot" | "phone";
export interface BookTableState { step: Step; outletId?: string; outlets?: Record<string, string>; party?: number; days?: string[]; date?: string; slots?: Record<string, string>; startIso?: string }

export type BookTableOutcome =
  | { kind: "waiting" }                 // asked something; the session waits for the reply
  | { kind: "booked"; ref: string }     // continue with the next node
  | { kind: "skip"; message?: string }  // not linked / off: say the fallback and move on
  | { kind: "ended" }                   // failed for good: session ends
  | { kind: "not_mine" };               // the reply isn't an answer — let the AI field it

const LIST_MAX = 10;

function upcomingDays(timezone: string, count: number, now = new Date()): { date: string; label: string }[] {
  const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtLabel = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" });
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(now.getTime() + i * 86_400_000);
    return { date: fmtDate.format(at), label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtLabel.format(at) };
  });
}

async function askParty(io: BookTableIO, outlet: mez.MezOutlet, prompt: string): Promise<BookTableOutcome> {
  const max = Math.min(LIST_MAX, outlet.online_booking.max_party);
  await io.list(prompt || "How many guests?", "Guests", Array.from({ length: max }, (_, i) => ({ id: `p${i + 1}`, title: `${i + 1} ${i === 0 ? "guest" : "guests"}` })));
  await io.save({ step: "party", outletId: outlet.id });
  return { kind: "waiting" };
}

async function askDay(io: BookTableIO, outlet: mez.MezOutlet, party: number, note = ""): Promise<BookTableOutcome> {
  const days = upcomingDays(outlet.timezone, Math.min(7, Math.max(1, outlet.online_booking.days_ahead + 1)));
  await io.list(`${note}Which day?`, "Days", days.map(d => ({ id: `d${d.date}`, title: d.label })));
  await io.save({ step: "day", outletId: outlet.id, party, days: days.map(d => `d${d.date}`) });
  return { kind: "waiting" };
}

async function findOutlet(key: string, id: string | undefined): Promise<mez.MezOutlet | null> {
  const res = await mez.outlets(key);
  if (!res.ok) return null;
  return res.data.outlets.find(o => o.id === id) ?? null;
}

/** Runs when the flow reaches the step. */
export async function startTableBooking(tenantId: string, io: BookTableIO, d: { text?: string; outlet?: string; fallback?: string }): Promise<BookTableOutcome> {
  const link = await restaurantLink(tenantId, io.kind);
  if (!link) return { kind: "skip", message: d.fallback };
  const res = await mez.outlets(link.key);
  if (!res.ok) return { kind: "skip", message: d.fallback || "Sorry, I can't check tables right now — our team will get back to you." };
  const bookable = res.data.outlets.filter(o => o.online_booking.enabled);
  if (!bookable.length) return { kind: "skip", message: d.fallback || "Table booking in chat isn't available right now — please call us to book." };
  const outlet = mez.pickOutlet(bookable, d.outlet, link.defaultOutletId);
  if (outlet) return askParty(io, outlet, d.text ?? "");
  const choices = bookable.slice(0, LIST_MAX);
  await io.list("Which outlet would you like to book?", "Outlets", choices.map((o, i) => ({ id: `o${i}`, title: o.name.slice(0, 24) })));
  await io.save({ step: "outlet", outlets: Object.fromEntries(choices.map((o, i) => [`o${i}`, o.id])) });
  return { kind: "waiting" };
}

/** Runs on each reply while the step waits. */
export async function continueTableBooking(tenantId: string, io: BookTableIO, state: BookTableState, reply: string): Promise<BookTableOutcome> {
  const link = await restaurantLink(tenantId, io.kind);
  if (!link) {
    await io.text("Sorry, I can't book tables right now — please call us.");
    return { kind: "ended" };
  }

  if (state.step === "outlet") {
    const ids = Object.keys(state.outlets ?? {});
    const pick = matchSlot(reply, ids);
    if (!pick) return { kind: "not_mine" };
    const outlet = await findOutlet(link.key, state.outlets![pick]);
    if (!outlet) { await io.text("Sorry, I can't check tables right now — please try again in a bit."); return { kind: "ended" }; }
    return askParty(io, outlet, "");
  }

  const outlet = await findOutlet(link.key, state.outletId);
  if (!outlet || !outlet.online_booking.enabled) { await io.text("Sorry, table booking in chat isn't available right now — please call us."); return { kind: "ended" }; }

  if (state.step === "party") {
    // A tapped row ("p4"), a number ("4") or the row's title ("4 guests").
    const t = reply.trim().toLowerCase();
    const m = /^p(\d{1,2})$/.exec(t) ?? /^(\d{1,3})(?:\s*(?:guests?|people|persons?|pax))?$/.exec(t);
    const n = m ? Number(m[1]) : NaN;
    if (!Number.isInteger(n) || n < 1) return { kind: "not_mine" };
    if (n > outlet.online_booking.max_party) {
      await io.text(`For more than ${outlet.online_booking.max_party} guests, please call us${outlet.phone ? ` on ${outlet.phone}` : ""} and we'll arrange it.`);
      return { kind: "ended" };
    }
    return askDay(io, outlet, n);
  }

  if (state.step === "day") {
    const pick = matchSlot(reply, state.days ?? []);
    const date = pick ? pick.slice(1) : null;
    if (!date || !state.party) return { kind: "not_mine" };
    const a = await mez.availability(link.key, outlet.id, date, state.party);
    if (!a.ok) { await io.text("Sorry, I can't check tables right now — please try again in a bit."); return { kind: "ended" }; }
    if (a.data.reason === "booking_off") { await io.text("Table booking in chat isn't available right now — please call us."); return { kind: "ended" }; }
    if (a.data.reason === "party_too_large") { await io.text(`For more than ${a.data.max_party} guests, please call us${outlet.phone ? ` on ${outlet.phone}` : ""}.`); return { kind: "ended" }; }
    if (!a.data.slots.length) return askDay(io, outlet, state.party, "No tables are free that day. ");
    const slots = a.data.slots.slice(0, LIST_MAX);
    await io.list("Pick a time:", "Times", slots.map((s, i) => ({ id: `s${i}`, title: s.label })));
    await io.save({ step: "slot", outletId: outlet.id, party: state.party, date, slots: Object.fromEntries(slots.map((s, i) => [`s${i}`, s.start])) });
    return { kind: "waiting" };
  }

  if (state.step === "slot" || state.step === "phone") {
    let startIso = state.startIso;
    if (state.step === "slot") {
      const pick = matchSlot(reply, Object.keys(state.slots ?? {}));
      if (!pick) return { kind: "not_mine" };
      startIso = state.slots![pick];
    }
    // WhatsApp: the sender's own number. Elsewhere: ask for one.
    let phone = io.kind === "whatsapp" ? mez.bookingPhone(io.phone) : null;
    if (state.step === "phone") phone = mez.bookingPhone(reply);
    if (!phone) {
      await io.text(state.step === "phone" ? "That doesn't look like a mobile number — please send it again (10 digits)." : "What's your mobile number for the booking?");
      await io.save({ step: "phone", outletId: outlet.id, party: state.party, date: state.date, startIso });
      return { kind: "waiting" };
    }
    const booked = await mez.book(link.key, tenantId, {
      outletId: outlet.id, slotStart: startIso!, partySize: state.party!, guestName: io.contactName || "Guest", phone,
      channel: io.kind as mez.ChatChannel,
    });
    if (booked.ok && booked.data.ref) {
      await io.text(`✅ Booked! Table for ${booked.data.party_size} at ${booked.data.outlet_name} on ${booked.data.date} at ${booked.data.time}.\nYour booking code: ${booked.data.ref}`);
      return { kind: "booked", ref: booked.data.ref };
    }
    if (!booked.ok && booked.code === "slot_unavailable" && state.party) return askDay(io, outlet, state.party, "That time was just taken. ");
    await io.text(booked.ok ? "Sorry, I couldn't confirm that booking — our team will get back to you." : `Sorry, I couldn't book that: ${booked.message}`);
    return { kind: "ended" };
  }
  return { kind: "not_mine" };
}
