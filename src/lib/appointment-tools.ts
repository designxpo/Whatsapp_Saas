// The AI booking an appointment in an ordinary conversation — the same
// calendar the chatbot flow's "Book meeting" step uses (Google Calendar or
// Cal.com, from Integrations), offered as two tools:
//   check_appointment_times  the next free times, from the calendar itself
//   book_appointment         book one of those times (only where the AI may act)
// Rules match the restaurant tools: offer only times the calendar returned,
// say "booked" only when book_appointment answered "Booked", and never guess.
// Every booking also lands in Talko's Bookings (integrations.recordBooked),
// from WhatsApp, Instagram, Messenger or web chat.

import type { ChatTool } from "./ai/chat";
import { scheduleSlots, scheduleBook, calcomBook, type BookedBy, type ScheduleProvider, type Slot } from "./integrations";
import type { Platform } from "./channel-label";

export const APPOINTMENT_FNS = { times: "check_appointment_times", book: "book_appointment" } as const;
export const isAppointmentTool = (name: string) => name === APPOINTMENT_FNS.times || name === APPOINTMENT_FNS.book;

export function appointmentTools(platform: Platform, canAct: boolean, provider: ScheduleProvider): ChatTool[] {
  const tools: ChatTool[] = [
    { name: APPOINTMENT_FNS.times, description: "The next free appointment times from the business's calendar. Call it before offering or booking any time.", params: [], required: [] },
  ];
  if (!canAct) return tools;
  tools.push({ name: APPOINTMENT_FNS.book, description: "Books one of the times check_appointment_times returned. Call it ONLY after the customer confirmed the time and the name to book under.", params: [
    { name: "time", description: "One of the times check_appointment_times listed, exactly as listed" },
    { name: "name", description: "The name to book under" },
    ...(provider === "calcom" ? [{ name: "email", description: "The customer's email for the calendar invite (ask for it)" }] : []),
    ...(platform === "whatsapp" ? [] : [{ name: "phone", description: "The customer's mobile number, if they gave one (optional)" }]),
  ], required: ["time", "name", ...(provider === "calcom" ? ["email"] : [])] });
  return tools;
}

export const APPOINTMENT_PROMPT = [
  "--- Appointments ---",
  "This business takes appointments through its calendar, reachable only through your tools.",
  "Offer only the times check_appointment_times listed in this conversation. Never guess a free time.",
  "Say an appointment is booked ONLY when book_appointment answered \"Booked\". If a tool says it could not check or could not book, say so and offer to have the team follow up.",
].join("\n");

export interface AppointmentCtx {
  tenantId: string;
  platform: Platform;
  canAct: boolean;
  /** WhatsApp number, or the chat key on Instagram / Messenger / web chat. */
  contactKey: string | null;
  conversationId: string | null;
  tz?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The offered slot the customer picked: its exact label, or a label containing what they said. Pure. */
export function pickSlot(said: string, slots: Slot[]): Slot | null {
  const w = norm(said);
  if (!w) return null;
  return slots.find(s => norm(s.label) === w) ?? slots.find(s => norm(s.label).includes(w)) ?? null;
}

export async function executeAppointmentTool(name: string, args: Record<string, unknown>, ctx: AppointmentCtx, provider: ScheduleProvider): Promise<{ status: string }> {
  const unreachable = "The calendar couldn't be checked right now. Offer to have the team confirm a time.";
  try {
    if (name === APPOINTMENT_FNS.book && !ctx.canAct) return { status: "Appointments can't be booked from here. Offer to have the team help." };
    const free = await scheduleSlots(ctx.tenantId, { tz: ctx.tz }).catch(() => null);
    if (!free) return { status: unreachable };
    if (name === APPOINTMENT_FNS.times) {
      return { status: free.slots.length ? `Free times: ${free.slots.map(s => s.label).join("; ")}.` : "No free times in the next few days. Offer to have the team suggest one." };
    }
    const slot = pickSlot(str(args.time), free.slots);
    if (!slot) return { status: free.slots.length ? `That time isn't free. Free times: ${free.slots.map(s => s.label).join("; ")}. Ask the customer to pick one.` : "No free times right now. Offer to have the team suggest one." };
    const who = str(args.name);
    if (!who) return { status: "Ask the customer for the name to book under." };
    const channel: NonNullable<BookedBy["channel"]> = ctx.platform === "instagram" || ctx.platform === "messenger" || ctx.platform === "webchat" ? ctx.platform : "whatsapp";
    const typedPhone = str(args.phone).replace(/\D/g, "");
    const bookedBy: BookedBy = channel === "whatsapp"
      ? { phone: ctx.contactKey ?? "", channel, conversationId: ctx.conversationId }
      : { phone: typedPhone.length >= 10 ? typedPhone : undefined, contactKey: ctx.contactKey ?? undefined, channel, conversationId: ctx.conversationId };
    let ok: boolean;
    if (provider === "calcom") {
      const email = str(args.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: "Ask the customer for their email for the calendar invite." };
      ok = await calcomBook(ctx.tenantId, { startIso: slot.iso, name: who, email, tz: ctx.tz, who: bookedBy });
    } else {
      ok = await scheduleBook(ctx.tenantId, { startIso: slot.iso, name: who, phone: channel === "whatsapp" ? ctx.contactKey ?? "" : typedPhone, channel, tz: ctx.tz, who: bookedBy });
    }
    return ok
      ? { status: `Booked: ${slot.label}, under ${who}. Confirm the time to the customer.` }
      : { status: "Not booked — that time was just taken or the calendar refused it. Check the free times again and offer them." };
  } catch {
    return { status: unreachable };
  }
}
