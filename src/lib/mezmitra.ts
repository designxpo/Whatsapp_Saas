import crypto from "crypto";
import { errorMessage } from "./errors";

// Mezmitra — the restaurant system (menu, tables, bookings, bills). A tenant
// that runs both products links them once (Integrations → Mezmitra); after that
// the AI and the "Book table" flow step read the live menu and book tables
// through Mezmitra's /v1/talko/* API, and Mezmitra sends bill/booking/order
// events to /api/events.
//
// Ownership is strict: Mezmitra owns the menu, prices, tables and bookings, so
// nothing here copies them. Every answer about them comes from a live call.
//
// Where Mezmitra lives is SERVER config (MEZMITRA_API_URL), never a tenant
// setting: a tenant cannot point the link at another host, so the key and
// guests' numbers only ever travel to our own Mezmitra deployment. Every call
// is bounded (8 s), never follows a redirect, and never throws.

export type MezResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

export function mezmitraBase(): string | null {
  const raw = process.env.MEZMITRA_API_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (process.env.NODE_ENV === "production" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

// A Mezmitra link key: mzk_ + 32 random bytes, base64url.
export const LINK_KEY_RE = /^mzk_[A-Za-z0-9_-]{43}$/;

async function call<T>(key: string, method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<MezResult<T>> {
  const base = mezmitraBase();
  if (!base) return { ok: false, status: 0, code: "not_configured", message: "The Mezmitra link isn't set up on this server." };
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "TalkoAI/1", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, data: (json ?? {}) as T };
    const err = (json?.error ?? {}) as { code?: string; message?: string };
    return { ok: false, status: res.status, code: err.code ?? `http_${res.status}`, message: err.message ?? `Mezmitra answered HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, code: "unreachable", message: `Couldn't reach Mezmitra: ${errorMessage(err)}`.slice(0, 200) };
  }
}

// ── Linking ──────────────────────────────────────────────────────────────────

export interface MezWhoami { tenant: { id: string; name: string; slug: string }; link: { id: string; status: "pending" | "active"; scopes: string[] } }

export const whoami = (key: string) => call<MezWhoami>(key, "GET", "/v1/talko/whoami");

// Completes a pending link: hands Mezmitra our API key (so it can send events)
// and the secret we sign opt-out webhooks with. Mezmitra accepts this once.
export const completeLink = (key: string, p: { apiKey: string; webhookSecret: string; account: string }) =>
  call<{ ok: boolean; webhook_path: string }>(key, "POST", "/v1/talko/link", { api_key: p.apiKey, webhook_secret: p.webhookSecret, account: p.account });

export const unlink = (key: string) => call<{ ok: boolean }>(key, "POST", "/v1/talko/unlink", {});

// ── Reading ──────────────────────────────────────────────────────────────────

export interface MezOutlet {
  id: string; name: string; address: string | null; city: string | null; phone: string | null; timezone: string;
  opening_hours: Record<string, [string, string][]> | null;
  online_booking: { enabled: boolean; max_party: number; days_ahead: number };
}
export interface MezMenuItem { id: string; name: string; description?: string | null; price_paise: number; is_veg: boolean; in_stock: boolean; available_now?: boolean }
export interface MezMenu { categories: { id: string; name: string; items: MezMenuItem[] }[] }
export interface MezSlots { outlet_id: string; outlet_name: string; date: string; party_size: number; max_party: number; reason: "booking_off" | "party_too_large" | null; slots: { start: string; label: string }[] }
export interface MezBooking { id: string; ref: string | null; outlet_id: string; outlet_name: string; slot_start: string; date: string; time: string; party_size: number; status: string }

export const outlets = (key: string) => call<{ outlets: MezOutlet[] }>(key, "GET", "/v1/talko/outlets");
export const menu = (key: string, outletId: string) => call<MezMenu>(key, "GET", `/v1/talko/outlets/${encodeURIComponent(outletId)}/menu`);
export const availability = (key: string, outletId: string, date: string, partySize: number) =>
  call<MezSlots>(key, "GET", `/v1/talko/outlets/${encodeURIComponent(outletId)}/availability?date=${encodeURIComponent(date)}&party_size=${partySize}`);
// POST, so the guest's number stays out of URLs and access logs.
export const bookingsFor = (key: string, phone: string) => call<{ bookings: MezBooking[] }>(key, "POST", "/v1/talko/reservations/lookup", { phone });

// ── Booking ──────────────────────────────────────────────────────────────────

export type ChatChannel = "whatsapp" | "instagram" | "messenger" | "webchat";

// The same guest asking for the same table twice in a row (a re-sent message,
// a model that calls the tool twice, a retry after a timeout) gets the first
// answer back, not a second booking. Scoped to a 10-minute window: a guest who
// cancels and books the same table again later makes a fresh request, not a
// replay of the cancelled one. (Mezmitra also returns an existing identical
// booking, so a retry across the window's edge still books once.)
export function bookingKey(tenantId: string, p: { outletId: string; slotStart: string; partySize: number; phone: string }, now = Date.now()): string {
  const window = Math.floor(now / 600_000);
  return crypto.createHash("sha256").update([tenantId, p.outletId, p.slotStart, p.partySize, p.phone, window].join("|")).digest("hex").slice(0, 64);
}

export const book = (key: string, tenantId: string, p: { outletId: string; slotStart: string; partySize: number; guestName: string; phone: string; channel: ChatChannel; externalRef?: string | null }) =>
  call<MezBooking>(key, "POST", `/v1/talko/outlets/${encodeURIComponent(p.outletId)}/reservations`, {
    slot_start: p.slotStart,
    party_size: p.partySize,
    guest_name: p.guestName.slice(0, 80) || "Guest",
    phone: p.phone,
    channel: p.channel,
    external_ref: p.externalRef ?? null,
  }, { "Idempotency-Key": bookingKey(tenantId, p) });

export const cancel = (key: string, ref: string, phone: string) =>
  call<MezBooking>(key, "POST", `/v1/talko/reservations/${encodeURIComponent(ref)}/cancel`, { phone });

// ── Small pure helpers (unit-tested) ─────────────────────────────────────────

// "₹250" / "₹180.50" for menu answers.
export function rupees(paise: number): string {
  return paise % 100 === 0 ? `₹${(paise / 100).toLocaleString("en-IN")}` : `₹${(paise / 100).toFixed(2)}`;
}

// The outlet a guest means: by name when they said one, else the only one, else
// the tenant's default. Null = ask which.
export function pickOutlet(list: MezOutlet[], wanted: string | undefined, defaultId: string | null): MezOutlet | null {
  const q = (wanted ?? "").trim().toLowerCase();
  if (q) {
    const exact = list.find(o => o.name.toLowerCase() === q);
    if (exact) return exact;
    const partial = list.filter(o => o.name.toLowerCase().includes(q) || (o.city ?? "").toLowerCase() === q);
    if (partial.length === 1) return partial[0];
    return null;
  }
  if (list.length === 1) return list[0];
  return list.find(o => o.id === defaultId) ?? null;
}

// Match what a guest or the model said ("8 pm", "20:00", "8:30pm") to one of the
// offered slots. Only offered slots can be booked; anything else is null.
export function matchOfferedTime(input: string, slots: { start: string; label: string }[], timezone: string): { start: string; label: string } | null {
  const t = input.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
  if (!t) return null;
  const direct = slots.find(s => s.label.toLowerCase().replace(/\s+/g, "") === t || s.start === input.trim());
  if (direct) return direct;
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  const local = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    return { h: Number(parts.find(p => p.type === "hour")?.value), m: Number(parts.find(p => p.type === "minute")?.value) };
  };
  const hits = slots.filter(s => { const l = local(s.start); return l.m === minute && (l.h === hour || (!m[3] && l.h === hour + 12)); });
  return hits.length === 1 ? hits[0] : null;
}

// The phone Mezmitra should book under: on WhatsApp the sender's own number
// (verified by WhatsApp), elsewhere whatever the guest typed. Digits only, with
// a leading + so Mezmitra stores it as E.164.
export function bookingPhone(raw: string): string | null {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length >= 11 && d.length <= 15 && !d.startsWith("0")) return `+${d}`;
  return null;
}
