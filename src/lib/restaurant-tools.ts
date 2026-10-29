import type { ChatTool } from "./ai/chat";
import type { Platform } from "./channel-label";
import * as mez from "./mezmitra";
import { mezmitraLink } from "./integrations";
import { checkFeature } from "./entitlements";

// AI tools for a restaurant linked to Mezmitra. The model never knows the menu,
// prices, opening hours or free tables by itself: it calls these, and every
// answer comes live from Mezmitra. What a tool returns joins the grounding
// firewall's allow-set (toolFacts in llm.ts), so a price or time the tools gave
// survives it, and one they didn't give is stripped or deferred.
//
// Safety rules enforced HERE, not left to the prompt:
//   • A booking is "confirmed" only when Mezmitra answered 201 with a code.
//   • Only times Mezmitra offered can be booked (matchOfferedTime).
//   • Listing or cancelling someone's bookings needs a phone number WhatsApp
//     verified — so those tools exist only on WhatsApp, with the sender's own
//     number, never one typed into the chat.

export const RESTAURANT_FNS = {
  outlets: "restaurant_info",
  menu: "get_menu",
  availability: "check_table_availability",
  book: "book_table",
  mine: "my_bookings",
  cancel: "cancel_booking",
} as const;
const NAMES = new Set<string>(Object.values(RESTAURANT_FNS));
export const isRestaurantTool = (name: string) => NAMES.has(name);

const outletParam = { name: "outlet", description: "Which outlet, by name, when the restaurant has more than one. Leave empty if it has one." };

// `canAct`: the reply goes straight to the customer (see generateReply). Without
// it only the read tools are offered, so a draft or test cannot book anything.
export function restaurantTools(platform: Platform, canAct: boolean): ChatTool[] {
  const tools: ChatTool[] = [
    { name: RESTAURANT_FNS.outlets, description: "The restaurant's outlets: names, addresses, phone and opening hours, and whether tables can be booked in chat. Call it for questions about location, timings or which outlets exist.", params: [], required: [] },
    { name: RESTAURANT_FNS.menu, description: "The live menu with prices, veg/non-veg and what is sold out right now. Call it before answering ANY question about dishes, prices or availability of food.", params: [
      outletParam,
      { name: "search", description: "Optional words to narrow the menu, e.g. 'paneer' or 'desserts'" },
    ], required: [] },
    { name: RESTAURANT_FNS.availability, description: "Times a table is free on a date. Call it before offering or booking any time.", params: [
      outletParam,
      { name: "date", description: "The date in YYYY-MM-DD" },
      { name: "party_size", description: "Number of guests (a whole number)" },
    ], required: ["date", "party_size"] },
  ];
  if (!canAct) return tools;
  tools.push(
    { name: RESTAURANT_FNS.book, description: "Books a table at one of the times check_table_availability returned. Call it ONLY after the guest confirmed the date, time, number of guests and the name to book under.", params: [
      outletParam,
      { name: "date", description: "The date in YYYY-MM-DD" },
      { name: "time", description: "One of the times check_table_availability listed, exactly as listed (e.g. 8:00 pm)" },
      { name: "party_size", description: "Number of guests" },
      { name: "name", description: "The name to book under" },
      ...(platform === "whatsapp" ? [] : [{ name: "phone", description: "The guest's mobile number for the booking (ask for it)" }]),
    ], required: ["date", "time", "party_size", "name", ...(platform === "whatsapp" ? [] : ["phone"])] },
  );
  if (platform === "whatsapp") {
    tools.push(
      { name: RESTAURANT_FNS.mine, description: "This guest's upcoming table bookings.", params: [], required: [] },
      { name: RESTAURANT_FNS.cancel, description: "Cancels one of this guest's bookings by its booking code (BK…). Call it only after the guest confirmed which booking to cancel.", params: [
        { name: "booking_code", description: "The booking code, e.g. BK7Q4M2X" },
      ], required: ["booking_code"] },
    );
  }
  return tools;
}

export const RESTAURANT_PROMPT = [
  "--- Restaurant system ---",
  "This business is a restaurant. Its outlets, opening hours, menu, prices and table bookings live in its restaurant system, reachable only through your tools.",
  "Never state a dish, price, opening time, free table or booking unless a tool returned it in this conversation. Never guess a time or a price.",
  "Say a table is booked ONLY when book_table answered \"Booked\" with a booking code, and give the guest that code. If a tool says it could not check or could not book, say so and offer to have the team follow up.",
  "Offer only the times check_table_availability listed. For bigger groups than a tool allows, ask the guest to call the restaurant.",
].join("\n");

export interface RestaurantCtx {
  tenantId: string;
  platform: Platform;
  // The reply is sent straight to the customer; without it nothing is booked or cancelled.
  canAct: boolean;
  // WhatsApp: the sender's number (verified by WhatsApp). Elsewhere: a contact id, not a phone.
  phone: string | null;
  conversationId?: string | null;
}

// The tenant's live link, when the plan includes it. Null = no restaurant tools.
export async function restaurantLink(tenantId: string, platform: Platform): Promise<{ key: string; defaultOutletId: string | null } | null> {
  if (platform === "youtube") return null;
  const gate = await checkFeature(tenantId, "restaurant_link").catch(() => ({ ok: false }));
  if (!gate.ok) return null;
  const link = await mezmitraLink(tenantId);
  if (!link || !link.integration.active) return null;
  const def = link.integration.config.defaultOutletId;
  return { key: link.key, defaultOutletId: typeof def === "string" ? def : null };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const unreachable = "I couldn't reach the restaurant system just now — apologise and offer to have the team confirm.";

function hoursText(h: mez.MezOutlet["opening_hours"]): string {
  if (!h) return "opening hours not set";
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return days.map(d => `${d[0].toUpperCase()}${d.slice(1)} ${(h[d] ?? []).map(p => `${p[0]}–${p[1]}`).join(", ") || "closed"}`).join("; ");
}

async function resolveOutlet(key: string, wanted: string, defaultId: string | null): Promise<{ outlet: mez.MezOutlet } | { status: string }> {
  const res = await mez.outlets(key);
  if (!res.ok) return { status: unreachable };
  const outlet = mez.pickOutlet(res.data.outlets, wanted, defaultId);
  if (outlet) return { outlet };
  return { status: `Ask the guest which outlet they mean: ${res.data.outlets.map(o => o.name).join(", ") || "none listed"}.` };
}

// Runs one restaurant tool. Returns a plain-language status for the model.
// Never throws.
export async function executeRestaurantTool(
  name: string, args: Record<string, unknown>, ctx: RestaurantCtx, link: { key: string; defaultOutletId: string | null },
): Promise<{ status: string }> {
  try {
    // Checked again here, not only by which tools were offered.
    if (!ctx.canAct && (name === RESTAURANT_FNS.book || name === RESTAURANT_FNS.cancel)) {
      return { status: "Bookings can't be changed from here. Offer to have the team help." };
    }
    if (name === RESTAURANT_FNS.outlets) {
      const res = await mez.outlets(link.key);
      if (!res.ok) return { status: unreachable };
      return { status: res.data.outlets.map(o =>
        `${o.name}${o.address ? `, ${o.address}` : ""}${o.city ? `, ${o.city}` : ""}${o.phone ? ` — phone ${o.phone}` : ""}. Hours: ${hoursText(o.opening_hours)}. ${o.online_booking.enabled ? `Tables can be booked in chat for up to ${o.online_booking.max_party} guests.` : "Table booking in chat is off: guests should call."}`,
      ).join("\n") || "No outlets are listed." };
    }

    const where = await resolveOutlet(link.key, str(args.outlet), link.defaultOutletId);
    if ("status" in where) return where;
    const outlet = where.outlet;

    if (name === RESTAURANT_FNS.menu) {
      const res = await mez.menu(link.key, outlet.id);
      if (!res.ok) return { status: unreachable };
      const q = str(args.search).toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      for (const c of res.data.categories) {
        const inCategory = words.some(w => c.name.toLowerCase().includes(w));
        const items = c.items.filter(i => !words.length || inCategory || words.some(w => i.name.toLowerCase().includes(w) || (i.description ?? "").toLowerCase().includes(w)));
        if (!items.length) continue;
        lines.push(`${c.name}:`);
        for (const i of items) lines.push(`• ${i.name} — ${mez.rupees(i.price_paise)} (${i.is_veg ? "veg" : "non-veg"})${i.available_now === false || !i.in_stock ? " — not available right now" : ""}`);
        if (lines.length > 80) { lines.push("(more items not shown — ask the guest what they are looking for)"); break; }
      }
      return { status: lines.length ? `Menu at ${outlet.name}:\n${lines.join("\n")}` : `Nothing on the ${outlet.name} menu matches "${q}".` };
    }

    if (name === RESTAURANT_FNS.availability || name === RESTAURANT_FNS.book) {
      const date = str(args.date);
      const party = Math.round(Number(str(args.party_size)));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: "Ask the guest for the date." };
      if (!Number.isFinite(party) || party < 1 || party > 200) return { status: "Ask the guest how many people are coming." };
      const res = await mez.availability(link.key, outlet.id, date, party);
      if (!res.ok) return { status: res.status === 400 ? "That date looks wrong — ask the guest again." : unreachable };
      const a = res.data;
      if (a.reason === "booking_off") return { status: `${outlet.name} isn't taking table bookings in chat. The guest can call${outlet.phone ? ` ${outlet.phone}` : " the restaurant"}.` };
      if (a.reason === "party_too_large") return { status: `Chat bookings at ${outlet.name} are for up to ${a.max_party} guests. Ask the guest to call${outlet.phone ? ` ${outlet.phone}` : " the restaurant"} for a bigger group.` };

      if (name === RESTAURANT_FNS.availability) {
        if (!a.slots.length) return { status: `No tables free at ${outlet.name} on ${date} for ${party}. Offer another date.` };
        return { status: `Free times at ${outlet.name} on ${date} for ${party}: ${a.slots.map(s => s.label).join(", ")}.` };
      }

      const slot = mez.matchOfferedTime(str(args.time), a.slots, outlet.timezone);
      if (!slot) return { status: a.slots.length ? `That time isn't free. Free times on ${date}: ${a.slots.map(s => s.label).join(", ")}. Ask the guest to pick one.` : `No tables free on ${date}. Offer another date.` };
      const guestName = str(args.name);
      if (!guestName) return { status: "Ask the guest for the name to book under." };
      const phone = ctx.platform === "whatsapp" ? (ctx.phone ? mez.bookingPhone(ctx.phone) : null) : mez.bookingPhone(str(args.phone));
      if (!phone) return { status: "Ask the guest for their mobile number for the booking." };
      const booked = await mez.book(link.key, ctx.tenantId, {
        outletId: outlet.id, slotStart: slot.start, partySize: party, guestName, phone,
        channel: ctx.platform as mez.ChatChannel, externalRef: ctx.conversationId ?? null,
      });
      if (!booked.ok) {
        if (booked.code === "slot_unavailable") return { status: "That time was just taken. Check availability again and offer the guest the new times." };
        if (booked.code === "too_many_bookings" || booked.code === "party_too_large" || booked.code === "booking_off") return { status: `Not booked: ${booked.message}` };
        return { status: `Not booked — the restaurant system said: ${booked.message}. Apologise and offer to have the team call.` };
      }
      const b = booked.data;
      return { status: `Booked. Code ${b.ref}: table for ${b.party_size} at ${b.outlet_name} on ${b.date} at ${b.time}, under ${guestName}. Give the guest the booking code.` };
    }

    if (name === RESTAURANT_FNS.mine || name === RESTAURANT_FNS.cancel) {
      // Only on WhatsApp, only with the sender's own number (see the header).
      const phone = ctx.platform === "whatsapp" && ctx.phone ? mez.bookingPhone(ctx.phone) : null;
      if (!phone) return { status: "Bookings can only be looked up or cancelled on WhatsApp. Ask the guest to call the restaurant." };
      if (name === RESTAURANT_FNS.mine) {
        const res = await mez.bookingsFor(link.key, phone);
        if (!res.ok) return { status: unreachable };
        if (!res.data.bookings.length) return { status: "This guest has no upcoming bookings." };
        return { status: "Upcoming bookings:\n" + res.data.bookings.map(b => `• ${b.ref ?? "(made by phone)"} — ${b.party_size} at ${b.outlet_name} on ${b.date} at ${b.time}`).join("\n") };
      }
      const ref = str(args.booking_code).toUpperCase().replace(/\s+/g, "");
      if (!/^BK[A-Z0-9]{6}$/.test(ref)) return { status: "Ask the guest for the booking code (it starts with BK)." };
      const res = await mez.cancel(link.key, ref, phone);
      if (res.ok) return { status: `Cancelled booking ${ref} at ${res.data.outlet_name} on ${res.data.date} at ${res.data.time}.` };
      if (res.status === 404) return { status: `No upcoming booking ${ref} under this number. Ask the guest to check the code.` };
      return { status: `Not cancelled: ${res.message}` };
    }
  } catch (err) {
    console.error("[restaurant-tools] failed:", name, err);
    return { status: unreachable };
  }
  return { status: "unknown function" };
}
