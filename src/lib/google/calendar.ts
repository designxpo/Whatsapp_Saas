// Google Calendar: the times a business is free, and booking one of them from
// a chat (the flow's "Book meeting" step, through scheduleSlots/scheduleBook in
// src/lib/integrations.ts — Cal.com is the other provider for that step).
//
// The business shares one calendar with the portal's service account (auth.ts)
// with "Make changes to events". The portal reads when the calendar is busy and
// adds the booked event. It cannot invite the customer as a guest: Google lets
// a service account fill the attendee list only with Google Workspace
// domain-wide delegation. So the customer's name and number go in the event's
// description, and the WhatsApp confirmation is their record.
//
// Calendar API v3 facts relied on (developers.google.com/workspace/calendar/api/v3/reference):
//   GET  /calendars/{calendarId}                    → summary, timeZone
//   POST /freeBusy {timeMin, timeMax, timeZone, items:[{id}]}
//        → calendars[id].busy[{start, end}] (end exclusive), calendars[id].errors[{reason}]
//        Authorised by .../auth/calendar (NOT by calendar.events).
//   POST /calendars/{calendarId}/events?sendUpdates=none → id, htmlLink
//   DELETE /calendars/{calendarId}/events/{eventId}
//
// Times are offered and booked in the business's time zone (businessclock.ts,
// India unless BUSINESS_TZ says otherwise).

import { BUSINESS_TZ, partsIn, instantAt, weekdayIn } from "../businessclock";
import { googleCall, GoogleApiError } from "./api";
import { googleRobotEmail, NOT_SET_UP } from "./auth";

const API = "https://www.googleapis.com/calendar/v3";
const enc = encodeURIComponent;

export interface BookingSettings {
  calendarId: string;
  slotMinutes: number;
  /** Minutes after midnight the working day starts and ends. */
  startMin: number;
  endMin: number;
  /** Days of the week bookable, 0 Sunday … 6 Saturday. */
  days: number[];
  noticeMinutes: number;
  daysAhead: number;
  /** The event's title; {{name}} is the customer's name. */
  title: string;
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "10:00", "10", "10am", "7 pm", "19:30" → minutes after midnight; null when it isn't a time. */
export function parseClock(s: string): number | null {
  const m = (s ?? "").trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  }
  if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** "Mon-Sat", "Mon, Wed, Fri", "Mon-Fri, Sun" → [1,2,3,4,5,6] …; null when unreadable. */
export function parseDays(s: string): number[] | null {
  const out = new Set<number>();
  for (const part of (s ?? "").toLowerCase().split(/[,;]/).map(x => x.trim()).filter(Boolean)) {
    const [a, b] = part.split(/\s*(?:-|–|to)\s*/);
    const ia = DAY_NAMES.indexOf((a ?? "").slice(0, 3));
    if (ia < 0) return null;
    if (b === undefined) { out.add(ia); continue; }
    const ib = DAY_NAMES.indexOf(b.slice(0, 3));
    if (ib < 0) return null;
    for (let d = ia; ; d = (d + 1) % 7) { out.add(d); if (d === ib) break; }
  }
  return out.size ? [...out].sort() : null;
}

/** The connection's settings, or the problems a business must fix. Pure. */
export function bookingSettings(config: Record<string, string>): { settings: BookingSettings | null; problems: string[] } {
  const problems: string[] = [];
  const calendarId = (config.calendarId ?? "").trim();
  if (!calendarId) problems.push("Paste the Calendar ID (Google Calendar → Settings → your calendar → Integrate calendar).");
  const num = (v: string | undefined, def: number) => (v?.trim() ? Number(v.trim()) : def);
  const slotMinutes = num(config.slotMinutes, 30);
  if (!Number.isInteger(slotMinutes) || slotMinutes < 10 || slotMinutes > 240) problems.push("Appointment length must be a whole number of minutes, from 10 to 240.");
  const startMin = parseClock(config.workStart || "10:00");
  const endMin = parseClock(config.workEnd || "19:00");
  if (startMin === null || endMin === null) problems.push("Write the working hours as times, e.g. 10:00 and 19:00 (or 10am and 7pm).");
  else if (endMin <= startMin) problems.push("The working day must end after it starts.");
  const days = parseDays(config.workDays || "Mon-Sat");
  if (!days) problems.push("Write the working days like Mon-Sat, or Mon, Wed, Fri.");
  const noticeHours = num(config.noticeHours, 2);
  if (!Number.isFinite(noticeHours) || noticeHours < 0 || noticeHours > 24 * 14) problems.push("Minimum notice must be between 0 and 336 hours.");
  const daysAhead = num(config.daysAhead, 7);
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 30) problems.push("Days ahead must be a whole number from 1 to 30.");
  if (problems.length) return { settings: null, problems };
  return {
    settings: {
      calendarId, slotMinutes, startMin: startMin!, endMin: endMin!, days: days!,
      noticeMinutes: Math.round(noticeHours * 60), daysAhead,
      title: (config.eventTitle ?? "").trim().slice(0, 200) || "Call with {{name}}",
    },
    problems: [],
  };
}

export interface Busy { start: Date; end: Date }

/**
 * Every free start time from `now` to `daysAhead` days out. Pure.
 *
 * A slot is free when it lies inside working hours on a working day, starts
 * at least the notice period from now, and overlaps nothing busy (a busy
 * range's end is exclusive, so a meeting ending at 11:00 leaves 11:00 free).
 */
export function freeSlots(s: BookingSettings, busy: Busy[], now: Date, tz = BUSINESS_TZ()): Date[] {
  const earliest = now.getTime() + s.noticeMinutes * 60_000;
  const today = partsIn(now, tz);
  const out: Date[] = [];
  for (let d = 0; d <= s.daysAhead; d++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    const wall = { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
    const noon = instantAt({ ...wall, hour: 12 }, tz);
    if (!s.days.includes(weekdayIn(noon, tz))) continue;
    for (let m = s.startMin; m + s.slotMinutes <= s.endMin; m += s.slotMinutes) {
      const start = instantAt({ ...wall, hour: Math.floor(m / 60), minute: m % 60 }, tz);
      const end = start.getTime() + s.slotMinutes * 60_000;
      if (start.getTime() < earliest) continue;
      if (busy.some(b => b.start.getTime() < end && b.end.getTime() > start.getTime())) continue;
      out.push(start);
    }
  }
  return out;
}

/** What to tell the business when Google refuses. */
export function calendarProblem(err: unknown): string {
  const robot = googleRobotEmail() ?? "the portal's Google address";
  if (err instanceof GoogleApiError) {
    if (err.status === 404 || err.status === 403) {
      return `The portal can't see that calendar. In Google Calendar open Settings → your calendar → Share with specific people, add ${robot}, and choose "Make changes to events". Then check the Calendar ID.`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function calendarInfo(calendarId: string): Promise<{ summary: string; timeZone: string }> {
  const d = await googleCall("GET", `${API}/calendars/${enc(calendarId)}`);
  return { summary: String(d.summary ?? ""), timeZone: String(d.timeZone ?? "") };
}

/** When the calendar is busy between two instants. */
export async function busyBetween(calendarId: string, from: Date, to: Date): Promise<Busy[]> {
  const d = await googleCall("POST", `${API}/freeBusy`, {
    timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }],
  });
  const cal = ((d.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> | undefined) ?? {})[calendarId];
  // freeBusy answers 200 with a per-calendar error for one it cannot read.
  if (!cal || cal.errors?.length) throw new GoogleApiError(`Google could not read the calendar (${cal?.errors?.[0]?.reason ?? "not found"}).`, 404);
  return (cal.busy ?? []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/** Free start times, read live from the calendar. */
export async function liveSlots(s: BookingSettings, now = new Date()): Promise<Date[]> {
  const to = new Date(now.getTime() + (s.daysAhead + 1) * 86_400_000);
  return freeSlots(s, await busyBetween(s.calendarId, now, to), now);
}

export interface Booker { name: string; phone: string; channel: string }

/** The event body for a booking. Pure. */
export function bookingEvent(s: BookingSettings, start: Date, who: Booker): Record<string, unknown> {
  const end = new Date(start.getTime() + s.slotMinutes * 60_000);
  const name = who.name.trim() || (who.phone ? `+${who.phone}` : "a customer");
  return {
    summary: s.title.replace(/\{\{\s*name\s*\}\}/gi, name).slice(0, 250),
    description: [
      `Booked on ${who.channel} through the portal.`,
      `Name: ${who.name.trim() || "not given"}`,
      who.phone ? `WhatsApp: +${who.phone}` : "",
    ].filter(Boolean).join("\n"),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    // Lets the business find the portal's bookings, and the customer's number,
    // without parsing the description.
    extendedProperties: { private: { portal: "booking", ...(who.phone ? { phone: who.phone } : {}) } },
  };
}

/**
 * Book `start` if it is still free. Null when someone took it in the meantime
 * (the customer chose from a list that may be minutes old).
 */
export async function bookSlot(s: BookingSettings, start: Date, who: Booker): Promise<{ eventId: string; link: string } | null> {
  const end = new Date(start.getTime() + s.slotMinutes * 60_000);
  const busy = await busyBetween(s.calendarId, start, end);
  if (busy.some(b => b.start < end && b.end > start)) return null;
  const d = await googleCall("POST", `${API}/calendars/${enc(s.calendarId)}/events?sendUpdates=none`, bookingEvent(s, start, who));
  if (!d.id) throw new Error("Google accepted the booking but did not say which event it made.");
  return { eventId: String(d.id), link: String(d.htmlLink ?? "") };
}

/** "Tue 4 Nov" and "10:30 am" in the business's time zone. */
export function slotLabels(at: Date, tz = BUSINESS_TZ()): { day: string; time: string; dayKey: string; full: string } {
  const p = partsIn(at, tz);
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(at).replace(",", "");
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(at).toLowerCase();
  const dayKey = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { day, time, dayKey, full: `${day}, ${time}` };
}

// ── The connection ───────────────────────────────────────────────────────────

/**
 * Check a business's calendar: the portal can see it, can add to it, and has
 * free times to offer. The add check makes and immediately deletes an event in
 * the year 2000, where nobody looks, with no guests, so nobody is notified.
 */
export async function connectCalendar(config: Record<string, string>): Promise<{ ok: boolean; detail: string; config?: Record<string, string> }> {
  if (!googleRobotEmail()) return { ok: false, detail: NOT_SET_UP };
  const { settings, problems } = bookingSettings(config);
  if (!settings) return { ok: false, detail: problems.join(" ") };
  try {
    const info = await calendarInfo(settings.calendarId);
    try {
      const probe = await googleCall("POST", `${API}/calendars/${enc(settings.calendarId)}/events?sendUpdates=none`, {
        summary: "Connection check (deleted automatically)",
        start: { dateTime: "2000-01-01T00:00:00Z" }, end: { dateTime: "2000-01-01T00:05:00Z" },
        transparency: "transparent",
      });
      if (probe.id) await googleCall("DELETE", `${API}/calendars/${enc(settings.calendarId)}/events/${enc(String(probe.id))}?sendUpdates=none`).catch(() => undefined);
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 403) {
        return { ok: false, detail: `The portal can see “${info.summary}” but can't add bookings to it. In its sharing settings, change ${googleRobotEmail()} to "Make changes to events".` };
      }
      throw err;
    }
    const slots = await liveSlots(settings);
    const tz = BUSINESS_TZ();
    const zoneNote = info.timeZone && info.timeZone !== tz ? ` Times are offered in ${tz}; this calendar is set to ${info.timeZone}, and Google shows each booking at the right time in both.` : "";
    const next = slots[0] ? ` The next free time is ${slotLabels(slots[0]).full}.` : " There are no free times in the next " + settings.daysAhead + " days with these hours: check them.";
    return {
      ok: true,
      detail: `Connected to “${info.summary || settings.calendarId}”.${next}${zoneNote} Add a “Book meeting” step to a flow to let customers book.`,
      config: { calendarName: info.summary },
    };
  } catch (err) {
    return { ok: false, detail: calendarProblem(err) };
  }
}
