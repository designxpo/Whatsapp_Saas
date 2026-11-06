// Bookings kept in Talko: services (length, price, deposit), staff, and each
// booking's status from booked to completed or no-show. A booking can be added
// by a teammate, or arrive from Cal.com / Calendly (inbound connectors) or the
// AI booking a Google Calendar slot (integrations.scheduleBook).
//
// Rules:
//  - a staff member can't have two live bookings that overlap
//  - status moves forward only: booked → confirmed → completed | no_show; any
//    live booking can be cancelled; nothing comes back from cancelled
//  - a deposit is an order with a pay link (commerce), so paying it goes
//    through the normal payment path; its status is read from that order
//  - one reminder per booking, off by default (booking_settings), only inside
//    WhatsApp's 24-hour window or with an approved template

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getTenantSetting, setTenantSetting, appendConvMessage, isOptedOutStrict } from "./store";
import { createPaymentLink } from "./integrations";
import { listChannels, isLiveChannel } from "./channels";
import { sendText, sendTemplateSingle, fetchTemplates, bodyParamCount, type WaTemplate } from "./whatsapp";
import { accountCanSend } from "./feature-guard";
import type { WorkViewer } from "./tasks";

export type BookingStatus = "booked" | "confirmed" | "completed" | "no_show" | "cancelled";
export type BookingSource = "manual" | "google_calendar" | "calcom" | "calendly" | "mezvaan";
export type BookingChannel = "whatsapp" | "instagram" | "messenger" | "webchat";
const CHANNELS: BookingChannel[] = ["whatsapp", "instagram", "messenger", "webchat"];
const LIVE: BookingStatus[] = ["booked", "confirmed"];

export interface Service { id: string; name: string; durationMinutes: number; priceCents: number; depositCents: number; active: boolean }
export interface Staff { id: string; name: string; userId: string | null; active: boolean }
export interface Booking {
  id: string; phone: string; name: string; title: string; startsAt: string; endsAt: string; status: BookingStatus; source: BookingSource;
  /** Where the customer booked, and the key that opens their chat in Live Chat. */
  channel: BookingChannel; chatKey: string;
  serviceId: string | null; serviceName: string | null; staffId: string | null; staffName: string | null;
  depositCents: number; deposit: "none" | "requested" | "paid"; depositUrl: string | null;
  reminderSentAt: string | null; reminderDetail: string | null; notes: string; cancelReason: string | null;
}
export interface BookingSettings { reminder: { enabled: boolean; hoursBefore: number; template: { name: string; language: string } | null } }

export const BOOKING_SETTINGS_KEY = "booking_settings";
const missing = (e: { code?: string } | null | undefined) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");
const SETUP = "Bookings are still being set up for your workspace. Try again shortly.";

export function normalizeBookingSettings(raw: unknown): BookingSettings {
  const r = ((raw && typeof raw === "object" ? raw : {}) as { reminder?: Record<string, unknown> }).reminder ?? {};
  const t = r.template as { name?: unknown; language?: unknown } | null | undefined;
  const hours = Math.round(Number(r.hoursBefore));
  return { reminder: {
    enabled: r.enabled === true,
    hoursBefore: Number.isFinite(hours) ? Math.min(48, Math.max(1, hours)) : 3,
    template: t && typeof t.name === "string" && t.name.trim() ? { name: t.name.trim(), language: typeof t.language === "string" && t.language ? t.language : "en" } : null,
  } };
}
export const getBookingSettings = async (tenantId: string) => normalizeBookingSettings(await getTenantSetting<unknown>(tenantId, BOOKING_SETTINGS_KEY, {}).catch(() => ({})));
export async function saveBookingSettings(tenantId: string, raw: unknown): Promise<BookingSettings> {
  const s = normalizeBookingSettings(raw);
  await setTenantSetting(tenantId, BOOKING_SETTINGS_KEY, s);
  return s;
}

// ── Services and staff ────────────────────────────────────────────────────────

export async function listServices(tenantId: string): Promise<{ services: Service[]; staff: Staff[]; setupPending?: boolean }> {
  const [sv, st] = await Promise.all([
    tdb(tenantId).from("wa_booking_services").select("*").order("name"),
    tdb(tenantId).from("wa_booking_staff").select("*").order("name"),
  ]);
  if (sv.error || st.error) return { services: [], staff: [], setupPending: missing(sv.error) || missing(st.error) };
  return {
    services: ((sv.data ?? []) as unknown as Record<string, unknown>[]).map(r => ({ id: r.id as string, name: r.name as string, durationMinutes: r.duration_minutes as number, priceCents: r.price_cents as number, depositCents: r.deposit_cents as number, active: r.active as boolean })),
    staff: ((st.data ?? []) as unknown as Record<string, unknown>[]).map(r => ({ id: r.id as string, name: r.name as string, userId: (r.user_id as string | null) ?? null, active: r.active as boolean })),
  };
}

export async function saveService(tenantId: string, s: { id?: string; name?: unknown; durationMinutes?: unknown; priceCents?: unknown; depositCents?: unknown; active?: unknown }): Promise<{ error?: string; status?: number; ok?: true }> {
  const name = typeof s.name === "string" ? s.name.trim() : "";
  const dur = Math.round(Number(s.durationMinutes ?? 30));
  const price = Math.round(Number(s.priceCents ?? 0)), dep = Math.round(Number(s.depositCents ?? 0));
  if (!name || name.length > 120) return { error: "Give the service a name.", status: 400 };
  if (!Number.isFinite(dur) || dur < 5 || dur > 720) return { error: "Length must be between 5 minutes and 12 hours.", status: 400 };
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(dep) || dep < 0) return { error: "Prices can't be negative.", status: 400 };
  if (dep > 0 && price > 0 && dep > price) return { error: "The deposit can't be more than the price.", status: 400 };
  const row = { name, duration_minutes: dur, price_cents: price, deposit_cents: dep, active: s.active !== false };
  const { error } = s.id ? await tdb(tenantId).from("wa_booking_services").update(row).eq("id", s.id) : await tdb(tenantId).from("wa_booking_services").insert(row);
  if (error) return error.code === "23505" ? { error: "You already have a service with that name.", status: 409 } : missing(error) ? { error: SETUP, status: 503 } : { error: error.message, status: 500 };
  return { ok: true };
}

export async function saveStaff(tenantId: string, s: { id?: string; name?: unknown; userId?: unknown; active?: unknown }): Promise<{ error?: string; status?: number; ok?: true }> {
  const name = typeof s.name === "string" ? s.name.trim() : "";
  if (!name || name.length > 120) return { error: "Give the staff member a name.", status: 400 };
  const userId = typeof s.userId === "string" && s.userId ? s.userId : null;
  if (userId) {
    const { data } = await db().from("wa_users").select("id").eq("tenant_id", tenantId).eq("id", userId).maybeSingle();
    if (!data) return { error: "That teammate isn't in this workspace.", status: 400 };
  }
  const row = { name, user_id: userId, active: s.active !== false };
  const { error } = s.id ? await tdb(tenantId).from("wa_booking_staff").update(row).eq("id", s.id) : await tdb(tenantId).from("wa_booking_staff").insert(row);
  if (error) return error.code === "23505" ? { error: "You already have someone with that name.", status: 409 } : missing(error) ? { error: SETUP, status: 503 } : { error: error.message, status: 500 };
  return { ok: true };
}

// ── Bookings ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

async function hydrate(tenantId: string, rows: Row[]): Promise<Booking[]> {
  const { services, staff } = await listServices(tenantId);
  const orderIds = rows.map(r => r.deposit_order_id).filter(Boolean) as string[];
  const { data: orders } = orderIds.length ? await db().from("wa_orders").select("id,status,payment_url").eq("tenant_id", tenantId).in("id", orderIds) : { data: [] };
  const ord = new Map(((orders ?? []) as { id: string; status: string; payment_url: string | null }[]).map(o => [o.id, o]));
  const convIds = rows.map(r => r.conversation_id).filter(Boolean) as string[];
  const { data: convs } = convIds.length ? await db().from("wa_conversations").select("id,phone").eq("tenant_id", tenantId).in("id", convIds) : { data: [] };
  const chat = new Map(((convs ?? []) as { id: string; phone: string }[]).map(c => [c.id, c.phone]));
  return rows.map(r => {
    const o = r.deposit_order_id ? ord.get(r.deposit_order_id as string) : undefined;
    return {
      id: r.id as string, phone: r.phone as string, name: (r.name as string) ?? "", title: (r.title as string) ?? "",
      startsAt: r.starts_at as string, endsAt: r.ends_at as string, status: r.status as BookingStatus, source: r.source as BookingSource,
      channel: (CHANNELS.includes(r.channel as BookingChannel) ? r.channel : "whatsapp") as BookingChannel,
      chatKey: (r.conversation_id ? chat.get(r.conversation_id as string) : null) ?? (r.phone as string),
      serviceId: (r.service_id as string | null) ?? null, serviceName: services.find(s => s.id === r.service_id)?.name ?? null,
      staffId: (r.staff_id as string | null) ?? null, staffName: staff.find(s => s.id === r.staff_id)?.name ?? null,
      depositCents: (r.deposit_cents as number) ?? 0,
      deposit: !o ? "none" : o.status === "paid" || o.status === "fulfilled" ? "paid" : "requested", depositUrl: o?.payment_url ?? null,
      reminderSentAt: (r.reminder_sent_at as string | null) ?? null, reminderDetail: (r.reminder_detail as string | null) ?? null,
      notes: (r.notes as string) ?? "", cancelReason: (r.cancel_reason as string | null) ?? null,
    };
  });
}

/** Which staff a teammate's view is limited to: admins and leads see everyone; a member sees the staff linked to them. */
async function staffScope(v: WorkViewer, myId: string | null): Promise<string[] | null> {
  if (v.canManage) return null;
  const { data } = await tdb(v.tenantId).from("wa_booking_staff").select("id").eq("user_id", myId ?? "-");
  return ((data ?? []) as unknown as { id: string }[]).map(s => s.id);
}

export async function listBookings(v: WorkViewer, myId: string | null, fromIso: string, toIso: string): Promise<{ bookings: Booking[]; setupPending?: boolean }> {
  const { data, error } = await tdb(v.tenantId).from("wa_bookings").select("*").gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at", { ascending: true }).limit(500);
  if (error) return missing(error) ? { bookings: [], setupPending: true } : Promise.reject(error);
  const scope = await staffScope(v, myId);
  const rows = ((data ?? []) as unknown as Row[]).filter(r => !scope || scope.includes(r.staff_id as string));
  return { bookings: await hydrate(v.tenantId, rows) };
}

/** A live booking for this staff member overlapping [start, end), other than `except`. */
async function clash(tenantId: string, staffId: string, start: string, end: string, except?: string): Promise<boolean> {
  const { data } = await tdb(tenantId).from("wa_bookings").select("id,starts_at,ends_at").eq("staff_id", staffId).in("status", LIVE).lt("starts_at", end).gt("ends_at", start);
  return ((data ?? []) as unknown as { id: string }[]).some(b => b.id !== except);
}

export interface BookingInput { phone?: unknown; name?: unknown; serviceId?: unknown; staffId?: unknown; startsAt?: unknown; durationMinutes?: unknown; title?: unknown; notes?: unknown }

export async function createBooking(v: WorkViewer, input: BookingInput): Promise<{ booking?: Booking; error?: string; status?: number }> {
  const phone = typeof input.phone === "string" ? input.phone.replace(/\D/g, "") : "";
  if (phone.length < 10) return { error: "Enter the customer's WhatsApp number with country code.", status: 400 };
  const start = typeof input.startsAt === "string" ? Date.parse(input.startsAt) : NaN;
  if (!Number.isFinite(start)) return { error: "Choose a valid date and time.", status: 400 };
  const { services, staff, setupPending } = await listServices(v.tenantId);
  if (setupPending) return { error: SETUP, status: 503 };
  const service = typeof input.serviceId === "string" && input.serviceId ? services.find(s => s.id === input.serviceId) : null;
  if (input.serviceId && !service) return { error: "That service isn't in this workspace.", status: 400 };
  const member = typeof input.staffId === "string" && input.staffId ? staff.find(s => s.id === input.staffId) : null;
  if (input.staffId && !member) return { error: "That staff member isn't in this workspace.", status: 400 };
  const dur = service?.durationMinutes ?? Math.min(720, Math.max(5, Math.round(Number(input.durationMinutes ?? 30)) || 30));
  const startsAt = new Date(start).toISOString(), endsAt = new Date(start + dur * 60_000).toISOString();
  if (member && await clash(v.tenantId, member.id, startsAt, endsAt)) return { error: `${member.name} already has a booking at that time.`, status: 409 };
  const { data, error } = await tdb(v.tenantId).from("wa_bookings").insert({
    phone, name: typeof input.name === "string" ? input.name.trim().slice(0, 120) : "", service_id: service?.id ?? null, staff_id: member?.id ?? null,
    title: service?.name ?? (typeof input.title === "string" ? input.title.trim().slice(0, 120) : "Appointment"),
    starts_at: startsAt, ends_at: endsAt, status: "booked", source: "manual", deposit_cents: service?.depositCents ?? 0,
    notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "", created_by: v.user.email.toLowerCase(),
  }).select("*").single();
  if (error) return missing(error) ? { error: SETUP, status: 503 } : { error: error.message, status: 500 };
  return { booking: (await hydrate(v.tenantId, [data as unknown as Row]))[0] };
}

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  booked: ["confirmed", "completed", "no_show", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  completed: [], no_show: [], cancelled: [],
};

export async function updateBooking(v: WorkViewer, myId: string | null, id: string, patch: { status?: unknown; startsAt?: unknown; staffId?: unknown; cancelReason?: unknown }): Promise<{ booking?: Booking; error?: string; status?: number }> {
  const { data: cur } = await tdb(v.tenantId).from("wa_bookings").select("*").eq("id", id).maybeSingle();
  const b = cur as unknown as Row | null;
  const scope = await staffScope(v, myId);
  if (!b || (scope && !scope.includes(b.staff_id as string))) return { error: "Booking not found", status: 404 };
  const row: Row = { updated_at: new Date().toISOString() };
  const status = b.status as BookingStatus;
  if (patch.status !== undefined) {
    const to = patch.status as BookingStatus;
    if (!NEXT[status]?.includes(to)) return { error: `A ${status.replace("_", "-")} booking can't be marked ${String(to).replace("_", "-")}.`, status: 409 };
    if ((to === "completed" || to === "no_show") && Date.parse(b.starts_at as string) > Date.now()) return { error: "It hasn't started yet.", status: 409 };
    row.status = to;
    if (to === "cancelled") row.cancel_reason = typeof patch.cancelReason === "string" && patch.cancelReason.trim() ? patch.cancelReason.trim().slice(0, 300) : "Cancelled by the business";
  }
  if (patch.startsAt !== undefined || patch.staffId !== undefined) {
    if (!LIVE.includes(status)) return { error: "Only a live booking can be moved.", status: 409 };
    const start = patch.startsAt !== undefined ? Date.parse(String(patch.startsAt)) : Date.parse(b.starts_at as string);
    if (!Number.isFinite(start)) return { error: "Choose a valid date and time.", status: 400 };
    const dur = Date.parse(b.ends_at as string) - Date.parse(b.starts_at as string);
    const staffId = patch.staffId !== undefined ? (patch.staffId ? String(patch.staffId) : null) : (b.staff_id as string | null);
    if (staffId) {
      const { staff } = await listServices(v.tenantId);
      if (!staff.some(s => s.id === staffId)) return { error: "That staff member isn't in this workspace.", status: 400 };
      if (await clash(v.tenantId, staffId, new Date(start).toISOString(), new Date(start + dur).toISOString(), id)) return { error: "They already have a booking at that time.", status: 409 };
    }
    Object.assign(row, { starts_at: new Date(start).toISOString(), ends_at: new Date(start + dur).toISOString(), staff_id: staffId, reminder_sent_at: null, reminder_detail: null });
  }
  const { data, error } = await tdb(v.tenantId).from("wa_bookings").update(row).eq("id", id).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { booking: (await hydrate(v.tenantId, [data as unknown as Row]))[0] };
}

/**
 * Ask for the deposit: an order for the deposit amount with a pay link from the
 * workspace's payment integration. Sent in the chat when the customer wrote in
 * the last 24 hours; otherwise the link is returned for a teammate to share.
 */
export async function requestDeposit(v: WorkViewer, myId: string | null, id: string): Promise<{ url?: string; sent?: boolean; error?: string; status?: number }> {
  const { data: cur } = await tdb(v.tenantId).from("wa_bookings").select("*").eq("id", id).maybeSingle();
  const b = cur as unknown as Row | null;
  const scope = await staffScope(v, myId);
  if (!b || (scope && !scope.includes(b.staff_id as string))) return { error: "Booking not found", status: 404 };
  if (!LIVE.includes(b.status as BookingStatus)) return { error: "Only a live booking can take a deposit.", status: 409 };
  const amount = (b.deposit_cents as number) ?? 0;
  if (amount <= 0) return { error: "This booking's service has no deposit. Set one in Bookings → Services.", status: 400 };
  if (b.deposit_order_id) return { error: "A deposit was already requested for this booking.", status: 409 };
  const { data: order, error } = await db().from("wa_orders").insert({
    tenant_id: v.tenantId, phone: b.phone, items: [{ productId: `deposit:${id}`, name: `Deposit — ${b.title}`, priceCents: amount, qty: 1 }], total_cents: amount, status: "pending",
  }).select("id").single();
  if (error || !order) return { error: "Couldn't create the deposit order.", status: 500 };
  const link = await createPaymentLink(v.tenantId, { amountCents: amount, description: `Deposit — ${b.title}`, phone: b.phone as string });
  if (!link) {
    await db().from("wa_orders").update({ status: "cancelled" }).eq("tenant_id", v.tenantId).eq("id", (order as { id: string }).id);
    return { error: "Connect a payment provider (Razorpay or Stripe) in Integrations to take deposits.", status: 400 };
  }
  await db().from("wa_orders").update({ payment_ref: link.id, payment_url: link.url }).eq("tenant_id", v.tenantId).eq("id", (order as { id: string }).id);
  await tdb(v.tenantId).from("wa_bookings").update({ deposit_order_id: (order as { id: string }).id, updated_at: new Date().toISOString() }).eq("id", id);
  const when = new Date(b.starts_at as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  // Sent in the chat only on WhatsApp; for other channels the teammate shares the link there.
  const sent = (b.channel ?? "whatsapp") === "whatsapp" && await sendInWindow(v.tenantId, b.phone as string, `To confirm your ${b.title} on ${when}, please pay the deposit here: ${link.url}`);
  return { url: link.url, sent };
}

/** Send a plain message only when the customer wrote in the last 24 hours. */
async function sendInWindow(tenantId: string, phone: string, body: string): Promise<boolean> {
  if (await isOptedOutStrict(phone, tenantId).catch(() => true)) return false;
  const { data: conv } = await tdb(tenantId).from("wa_conversations").select("id,channel_id,last_inbound_at").eq("phone", phone).eq("platform", "whatsapp").maybeSingle();
  const c = conv as unknown as { id: string; channel_id: string | null; last_inbound_at: string | null } | null;
  if (!c?.last_inbound_at || Date.now() - Date.parse(c.last_inbound_at) >= 24 * 3_600_000) return false;
  const chs = (await listChannels(tenantId)).filter(x => x.kind === "whatsapp" && isLiveChannel(x));
  const ch = chs.find(x => x.id === c.channel_id) ?? chs.find(x => x.isDefault) ?? chs[0];
  if (!ch) return false;
  const r = await sendText(phone, body, ch).catch(() => ({ id: undefined }));
  if (!r.id) return false;
  await appendConvMessage({ conversationId: c.id, role: "assistant", body, metaId: r.id, source: "agent", tenantId, channelId: ch.id }).catch(() => undefined);
  return true;
}

/**
 * Record a booking made elsewhere (Cal.com, Calendly, the AI on Google
 * Calendar). Matched by the source's own reference; a reschedule moves the
 * earlier booking (by its previous reference, else the customer's next live
 * booking from that source); a cancellation cancels it. Best-effort.
 */
export async function recordExternalBooking(tenantId: string, e: {
  source: Exclude<BookingSource, "manual">; ref: string | null; previousRef?: string | null; kind: "created" | "rescheduled" | "cancelled";
  /** The customer's WhatsApp number, or for Instagram / Messenger / web chat their chat key. */
  phone: string; name?: string; title?: string; startsAt?: string | null; endsAt?: string | null; cancelReason?: string | null;
  channel?: BookingChannel; conversationId?: string | null;
}): Promise<"created" | "updated" | "cancelled" | "ignored"> {
  const t = tdb(tenantId).from("wa_bookings");
  const start = e.startsAt ? Date.parse(e.startsAt) : NaN;
  const end = e.endsAt && Number.isFinite(Date.parse(e.endsAt)) ? Date.parse(e.endsAt) : start + 30 * 60_000;
  const find = async (ref: string | null | undefined): Promise<Row | null> => {
    if (ref) {
      const { data } = await tdb(tenantId).from("wa_bookings").select("*").eq("source", e.source).eq("external_ref", ref).maybeSingle();
      if (data) return data as unknown as Row;
    }
    if (e.kind === "created") return null;
    const { data } = await tdb(tenantId).from("wa_bookings").select("*").eq("source", e.source).eq("phone", e.phone).in("status", LIVE)
      .gte("starts_at", new Date(Date.now() - 86_400_000).toISOString()).order("starts_at", { ascending: true }).limit(1);
    return ((data ?? []) as unknown as Row[])[0] ?? null;
  };
  if (e.kind === "cancelled") {
    const b = await find(e.ref);
    if (!b || !LIVE.includes(b.status as BookingStatus)) return "ignored";
    await tdb(tenantId).from("wa_bookings").update({ status: "cancelled", cancel_reason: e.cancelReason || "Cancelled by the customer", updated_at: new Date().toISOString() }).eq("id", b.id as string);
    return "cancelled";
  }
  if (!Number.isFinite(start) || !e.phone) return "ignored";
  const times = { starts_at: new Date(start).toISOString(), ends_at: new Date(Math.max(end, start + 5 * 60_000)).toISOString() };
  if (e.kind === "rescheduled") {
    const b = await find(e.previousRef ?? null) ?? (e.ref ? await find(e.ref) : null);
    if (b) {
      await tdb(tenantId).from("wa_bookings").update({ ...times, external_ref: e.ref ?? b.external_ref, reminder_sent_at: null, reminder_detail: null, updated_at: new Date().toISOString() }).eq("id", b.id as string);
      return "updated";
    }
  }
  if (e.ref && await find(e.ref)) return "ignored";   // a webhook retry
  // Already recorded from the chat that made it (before the tool's own webhook
  // arrived): same customer, same source, same start. Attach the reference.
  const { data: same } = await tdb(tenantId).from("wa_bookings").select("id,external_ref").eq("source", e.source).eq("phone", e.phone).eq("starts_at", times.starts_at).in("status", LIVE).limit(1);
  const twin = ((same ?? []) as unknown as { id: string; external_ref: string | null }[])[0];
  if (twin) {
    if (e.ref && !twin.external_ref) await tdb(tenantId).from("wa_bookings").update({ external_ref: e.ref, updated_at: new Date().toISOString() }).eq("id", twin.id);
    return "updated";
  }
  const row: Row = { phone: e.phone, name: (e.name ?? "").slice(0, 120), title: (e.title || "Appointment").slice(0, 120), ...times, status: "booked", source: e.source, external_ref: e.ref, created_by: e.source };
  const extra: Row = { ...(e.channel ? { channel: e.channel } : {}), ...(e.conversationId ? { conversation_id: e.conversationId } : {}) };
  let { error } = await t.insert({ ...row, ...extra });
  // Before migration 20261106240000 there's no channel / conversation column.
  if (error && Object.keys(extra).length && /channel|conversation_id/.test(error.message ?? "")) ({ error } = await tdb(tenantId).from("wa_bookings").insert(row));
  return error ? "ignored" : "created";
}

/** How long a table booking shows for: Mezvaan sends a start time, not an end. */
export const TABLE_MINUTES = 90;

/**
 * A Mezvaan table reservation — from its reservation events (WhatsApp
 * bookings, staff bookings) or from the AI's book_table / cancel_booking
 * tools on any channel. Matched by the booking code, so the event and the
 * tool's own record are one booking.
 */
export async function recordMezvaanBooking(tenantId: string, r: {
  kind: "created" | "cancelled"; ref: string | null; phone: string; name?: string | null;
  outletName?: string | null; partySize?: number | string | null; slotStart?: string | null;
  channel?: BookingChannel; conversationId?: string | null;
}): Promise<string> {
  const start = r.slotStart ? Date.parse(r.slotStart) : NaN;
  const party = Number(r.partySize);
  return recordExternalBooking(tenantId, {
    source: "mezvaan", kind: r.kind, ref: r.ref, phone: (r.phone ?? "").replace(/\D/g, "") || r.phone, name: r.name ?? undefined,
    title: `Table${Number.isFinite(party) && party > 0 ? ` for ${party}` : ""}${r.outletName ? ` — ${r.outletName}` : ""}`,
    startsAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
    endsAt: Number.isFinite(start) ? new Date(start + TABLE_MINUTES * 60_000).toISOString() : null,
    cancelReason: r.kind === "cancelled" ? "Cancelled in Mezvaan" : null, channel: r.channel, conversationId: r.conversationId ?? null,
  });
}

// ── Reminders ────────────────────────────────────────────────────────────────

const whenText = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const reminderText = (b: { name: string; title: string; startsAt: string }) =>
  `${b.name ? `Hi ${b.name.split(/\s+/)[0]}, a` : "A"} reminder of your ${b.title || "appointment"} on ${whenText(b.startsAt)}. Reply here if you need to change it.`;

/** One reminder per live booking starting within the workspace's lead time. */
export async function drainBookingReminders(now = Date.now(), max = 100): Promise<{ sent: number; skipped: number }> {
  const { data: settings } = await db().from("wa_settings").select("tenant_id,value").eq("key", BOOKING_SETTINGS_KEY).limit(500);
  let sent = 0, skipped = 0;
  for (const row of (settings ?? []) as { tenant_id: string; value: unknown }[]) {
    const cfg = normalizeBookingSettings(row.value).reminder;
    if (!cfg.enabled) continue;
    const tenantId = row.tenant_id;
    const { data, error } = await tdb(tenantId).from("wa_bookings").select("*").in("status", LIVE).is("reminder_sent_at", null)
      .gt("starts_at", new Date(now).toISOString()).lte("starts_at", new Date(now + cfg.hoursBefore * 3_600_000).toISOString()).limit(max);
    if (error || !data?.length) continue;
    if (!(await accountCanSend(tenantId).catch(() => false))) continue;
    const chs = (await listChannels(tenantId)).filter(x => x.kind === "whatsapp" && isLiveChannel(x));
    const ch = chs.find(x => x.isDefault) ?? chs[0];
    let templates: WaTemplate[] | null = null;
    for (const b of data as unknown as Row[]) {
      const claimed = await tdb(tenantId).from("wa_bookings").update({ reminder_sent_at: new Date(now).toISOString() }).eq("id", b.id as string).is("reminder_sent_at", null).select("id");
      if (!claimed.data?.length) continue;
      const note = async (detail: string) => { await tdb(tenantId).from("wa_bookings").update({ reminder_detail: detail }).eq("id", b.id as string); };
      const phone = b.phone as string;
      if (b.channel && b.channel !== "whatsapp") { skipped++; await note(`Booked on ${b.channel === "webchat" ? "web chat" : b.channel === "messenger" ? "Facebook" : "Instagram"} — WhatsApp reminders only go to WhatsApp bookings.`); continue; }
      if (!ch) { skipped++; await note("No WhatsApp number is connected to send from."); continue; }
      if (await isOptedOutStrict(phone, tenantId).catch(() => true)) { skipped++; await note("The customer opted out of messages."); continue; }
      const { data: conv } = await tdb(tenantId).from("wa_conversations").select("id,last_inbound_at").eq("phone", phone).eq("platform", "whatsapp").maybeSingle();
      const c = conv as unknown as { id: string; last_inbound_at: string | null } | null;
      const info = { name: (b.name as string) ?? "", title: (b.title as string) ?? "", startsAt: b.starts_at as string };
      let r: { id?: string; error?: string }, body: string;
      if (c?.last_inbound_at && now - Date.parse(c.last_inbound_at) < 24 * 3_600_000) {
        body = reminderText(info);
        r = await sendText(phone, body, ch).catch(e => ({ error: e instanceof Error ? e.message : "send failed" }));
      } else if (cfg.template) {
        templates ??= await fetchTemplates(ch).catch(() => []);
        const tpl = templates.find(t => t.name === cfg.template!.name && t.language === cfg.template!.language) ?? templates.find(t => t.name === cfg.template!.name);
        if (!tpl || tpl.status !== "APPROVED") { skipped++; await note(`The template “${cfg.template.name}” isn't approved.`); continue; }
        const n = bodyParamCount(tpl);
        if (n > 2) { skipped++; await note("The reminder template has more than 2 variables; use one with {{1}} = name and {{2}} = date and time."); continue; }
        const params = [info.name || "there", whenText(info.startsAt)].slice(0, n);
        body = `[Template: ${tpl.name}] ${whenText(info.startsAt)}`;
        r = await sendTemplateSingle(phone, tpl.name, tpl.language, params, ch).catch(e => ({ error: e instanceof Error ? e.message : "send failed" }));
      } else { skipped++; await note("Outside WhatsApp's 24-hour window and no reminder template is chosen."); continue; }
      if (!r.id) { skipped++; await note(r.error || "WhatsApp didn't accept the message."); continue; }
      sent++;
      await note("Sent");
      if (c?.id) await appendConvMessage({ conversationId: c.id, role: "assistant", body, metaId: r.id, source: "bot", tenantId, channelId: ch.id }).catch(() => undefined);
    }
  }
  return { sent, skipped };
}
