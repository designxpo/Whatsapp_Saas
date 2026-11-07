"use client";

// Bookings — one day at a time: who's coming, for what, with whom. Confirm,
// mark completed or a no-show, cancel, take a deposit, or add a booking.
// Services, staff and reminders are set up under Settings (admins).
// Bookings from Cal.com, Calendly and the AI's Google Calendar bookings
// appear here on their own (bookings.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Settings2, X } from "lucide-react";
import { Notice, useNotice } from "@/components/Notice";
import { toast } from "@/components/toast";
import { usePromptDialog } from "@/components/prompt-dialog";
import { EmptyState, inp, type GoTo } from "../_shared";

type Status = "booked" | "confirmed" | "completed" | "no_show" | "cancelled";
type Booking = {
  id: string; phone: string; name: string; title: string; startsAt: string; endsAt: string; status: Status; source: string;
  channel: "whatsapp" | "instagram" | "messenger" | "webchat"; chatKey: string;
  serviceName: string | null; staffName: string | null; depositCents: number; deposit: "none" | "requested" | "paid"; depositUrl: string | null;
  reminderSentAt: string | null; reminderDetail: string | null; notes: string; cancelReason: string | null;
};
type Service = { id: string; name: string; durationMinutes: number; priceCents: number; depositCents: number; active: boolean };
type Staff = { id: string; name: string; userId: string | null; active: boolean };
type Setup = { services: Service[]; staff: Staff[]; setupPending?: boolean; canManage: boolean; team: { id: string; name: string }[];
  settings: { reminder: { enabled: boolean; hoursBefore: number; template: { name: string; language: string } | null } } };

const STATUS: Record<Status, { label: string; cls: string }> = {
  booked: { label: "Booked", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  completed: { label: "Completed", cls: "bg-canvas text-ink-600 border-line" },
  no_show: { label: "No-show", cls: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Cancelled", cls: "bg-canvas text-ink-400 border-line line-through" },
};
const SOURCE: Record<string, string> = { manual: "Added here", google_calendar: "Google Calendar", calcom: "Cal.com", calendly: "Calendly", mezvaan: "Mezvaan" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Facebook", webchat: "Web chat" };
const rupees = (c: number) => `₹${(c / 100).toLocaleString("en-IN")}`;
const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function BookingsTab({ goTo }: { goTo: GoTo }) {
  const [day, setDay] = useState(() => dayStart(new Date()));
  const [list, setList] = useState<Booking[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [adding, setAdding] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useNotice();
  const [ask, dialog] = usePromptDialog();

  const load = useCallback(async () => {
    const to = new Date(day.getTime() + 86_400_000);
    const r = await fetch(`/api/admin/bookings?from=${encodeURIComponent(day.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    const j = await r.json();
    if (!r.ok) { setNote(j.error || "Couldn't load bookings."); setList([]); return; }
    setList(j.bookings ?? []);
  }, [day, setNote]);
  const loadSetup = useCallback(async () => { const r = await fetch("/api/admin/bookings/setup"); if (r.ok) setSetup(await r.json()); }, []);
  useEffect(() => { setList(null); void load(); }, [load]);
  useEffect(() => { void loadSetup(); }, [loadSetup]);

  async function act(b: Booking, body: Record<string, unknown>, done: string, method = "PATCH") {
    setBusy(b.id); setNote(null);
    try {
      const r = await fetch(`/api/admin/bookings/${b.id}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setNote(j.error || "That didn't work. Please try again.");
      else if (method === "POST" && !j.sent) { setNote(`Deposit link ready to share: ${j.url}`, "ok"); await load(); }
      else { toast(method === "POST" ? "Deposit link sent in the chat." : done); await load(); }
    } finally { setBusy(null); }
  }

  async function cancelBooking(b: Booking) {
    const who = b.name || (b.channel === "whatsapp" ? `+${b.phone}` : "this customer");
    const why = await ask({
      title: "Cancel this booking?",
      message: <>{b.title} with {who} at {time(b.startsAt)}. This can&apos;t be undone — you&apos;d need to add the booking again.</>,
      label: "Reason (optional)",
      placeholder: "e.g. Customer asked to reschedule",
      confirmLabel: "Cancel booking",
      cancelLabel: "Keep booking",
      tone: "danger",
    });
    if (why === null) return;
    await act(b, { status: "cancelled", cancelReason: why }, "Booking cancelled.");
  }

  const addBlocked = !setup ? "Loading your services…" : setup.setupPending ? "Bookings are still being set up for your workspace." : null;

  const label = day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const isToday = day.getTime() === dayStart(new Date()).getTime();
  const live = (list ?? []).filter(b => b.status !== "cancelled");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-ink-900"><CalendarDays className="h-5 w-5" /> Bookings</h1>
          <p className="max-w-2xl text-sm text-ink-600">Who&apos;s coming, for what and with whom. Bookings made in any chat — WhatsApp, Instagram, Facebook, web chat — and from Cal.com, Calendly and Mezvaan show up here on their own.</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAdding(a => !a)} disabled={!!addBlocked} title={addBlocked ?? undefined} aria-describedby={addBlocked ? "add-booking-why" : undefined} className="inline-flex min-h-10 items-center gap-1.5 rounded-control bg-brand-700 px-3 py-2 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add booking</button>
            {setup?.canManage && <button onClick={() => setShowSetup(s => !s)} className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line bg-white px-3 py-2 text-xs font-bold text-ink-700 hover:bg-canvas"><Settings2 className="h-3.5 w-3.5" /> Services &amp; staff</button>}
          </div>
          {addBlocked && setup && <p id="add-booking-why" className="text-[11px] text-ink-500">{addBlocked}</p>}
        </div>
      </header>

      <Notice notice={note} variant="banner" onClose={() => setNote(null)} />
      {setup?.setupPending && <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">Bookings are still being set up for your workspace.</div>}
      {showSetup && setup && <SetupPanel setup={setup} onChange={loadSetup} onClose={() => setShowSetup(false)} />}
      {adding && setup && <AddBooking setup={setup} day={day} onDone={() => { setAdding(false); toast("Booking added"); void load(); }} onCancel={() => setAdding(false)} />}

      <div className="flex items-center gap-2">
        <button onClick={() => setDay(d => new Date(d.getTime() - 86_400_000))} aria-label="Previous day" className="grid h-10 w-10 place-items-center rounded-control border border-line bg-white hover:bg-canvas"><ChevronLeft className="h-4 w-4" /></button>
        <p className="min-w-0 flex-1 text-center text-sm font-bold text-ink-900 sm:min-w-48 sm:flex-none">{label}</p>
        <button onClick={() => setDay(d => new Date(d.getTime() + 86_400_000))} aria-label="Next day" className="grid h-10 w-10 place-items-center rounded-control border border-line bg-white hover:bg-canvas"><ChevronRight className="h-4 w-4" /></button>
        {!isToday && <button onClick={() => setDay(dayStart(new Date()))} className="min-h-10 px-2 text-xs font-semibold text-brand-700 hover:underline">Today</button>}
        {list && <span className="ml-auto text-[12px] text-ink-500">{live.length} booking{live.length === 1 ? "" : "s"}</span>}
      </div>

      <section className="overflow-hidden rounded-card border border-line bg-white">
        {list === null ? <div className="flex items-center gap-2 p-4 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          : !list.length ? (
            <EmptyState mood="sleeping" title={isToday ? "No bookings today" : "No bookings on this day"}
              body="When a customer books in a chat, through Cal.com or Calendly, or you add one yourself, it shows up here with the time, the service and who they're seeing."
              action={<div className="flex flex-wrap justify-center gap-2">
                <button onClick={() => setAdding(true)} disabled={!!addBlocked} title={addBlocked ?? undefined} className="inline-flex min-h-10 items-center gap-1.5 rounded-control bg-brand-700 px-3 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Add a booking</button>
                <button onClick={() => goTo("integrations")} className="inline-flex min-h-10 items-center rounded-control border border-line bg-white px-3 text-xs font-bold text-ink-700 hover:bg-canvas">Connect your calendar</button>
              </div>} />
          ) : (
          <ul className="divide-y divide-line">
            {list.map(b => {
              const started = Date.parse(b.startsAt) <= Date.now();
              const liveB = b.status === "booked" || b.status === "confirmed";
              return (
                <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                  <div className="w-24 shrink-0 text-sm font-bold tabular-nums text-ink-900">{time(b.startsAt)}<span className="block text-[11px] font-normal text-ink-400">to {time(b.endsAt)}</span></div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[14px] font-bold text-ink-900">{b.title}</p>
                      <span className={`rounded-full border px-1.5 py-px text-[11px] font-bold ${STATUS[b.status].cls}`}>{STATUS[b.status].label}</span>
                      {b.deposit === "paid" && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[11px] font-bold text-emerald-700">Deposit paid</span>}
                      {b.deposit === "requested" && <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-bold text-amber-800">Deposit requested</span>}
                    </div>
                    <p className="text-[12px] text-ink-700">
                      <button onClick={() => goTo("livechat", { openPhone: b.chatKey || b.phone })} className="font-semibold hover:underline">{b.name || (b.channel === "whatsapp" ? `+${b.phone}` : "Open the chat")}</button>
                      {b.staffName && <> · with {b.staffName}</>} · <span className="text-ink-400">{SOURCE[b.source] ?? b.source}{b.source !== "manual" && b.channel ? ` · booked on ${CHANNEL[b.channel] ?? b.channel}` : ""}</span>
                    </p>
                    {b.reminderDetail && <p className="text-[11px] text-ink-500">Reminder: {b.reminderDetail === "Sent" ? `sent ${b.reminderSentAt ? new Date(b.reminderSentAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }) : ""}` : b.reminderDetail}</p>}
                    {b.cancelReason && b.status === "cancelled" && <p className="text-[11px] text-ink-500">{b.cancelReason}</p>}
                    {b.notes && <p className="text-[11px] text-ink-500">{b.notes}</p>}
                  </div>
                  {liveB && (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {b.status === "booked" && !started && <Btn onClick={() => void act(b, { status: "confirmed" }, "Booking confirmed.")} busy={busy === b.id}>Confirm</Btn>}
                      {started && <Btn onClick={() => void act(b, { status: "completed" }, "Marked as came.")} busy={busy === b.id}>Came</Btn>}
                      {started && <Btn onClick={() => void act(b, { status: "no_show" }, "Marked as a no-show.")} busy={busy === b.id}>No-show</Btn>}
                      {b.depositCents > 0 && b.deposit === "none" && !started && <Btn onClick={() => void act(b, { action: "deposit" }, "", "POST")} busy={busy === b.id}>Ask for {rupees(b.depositCents)} deposit</Btn>}
                      {b.deposit === "requested" && b.depositUrl && <button onClick={() => { void navigator.clipboard?.writeText(b.depositUrl!); toast("Deposit link copied"); }} className="min-h-8 rounded-control border border-line px-2 py-1 text-[12px] font-semibold text-ink-700 hover:bg-canvas">Copy deposit link</button>}
                      <button onClick={() => void cancelBooking(b)} disabled={busy === b.id}
                        className="min-h-8 rounded-control px-2 py-1 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Cancel</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {dialog}
      <p className="text-[11px] text-ink-400">Talko keeps a record of each booking and its status. Your calendar or booking tool stays where availability is managed.</p>
    </div>
  );
}

function Btn({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy: boolean }) {
  return <button onClick={onClick} disabled={busy} className="min-h-8 rounded-control border border-line bg-white px-2 py-1 text-[12px] font-bold text-ink-900 hover:bg-canvas disabled:opacity-50">{children}</button>;
}

function AddBooking({ setup, day, onDone, onCancel }: { setup: Setup; day: Date; onDone: () => void; onCancel: () => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const [f, setF] = useState({ phone: "", name: "", serviceId: "", staffId: "", at: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T10:00`, minutes: 30, notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const services = useMemo(() => setup.services.filter(s => s.active), [setup]);
  const problems = bookingProblems(f);
  const show = (k: keyof BookingProblems) => (tried ? problems[k] : undefined);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setTried(true);
    // Take them to the first field that needs fixing (it may be scrolled away on a phone).
    if (Object.keys(problems).length) { document.getElementById(problems.phone ? "bk-phone" : problems.at ? "bk-at" : "bk-min")?.focus(); return; }
    setSaving(true); setErr(null);
    const r = await fetch("/api/admin/bookings", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: f.phone, name: f.name, serviceId: f.serviceId || null, staffId: f.staffId || null, startsAt: new Date(f.at).toISOString(), durationMinutes: f.minutes, notes: f.notes }) });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) setErr(j.error || "Couldn't add the booking."); else onDone();
  }
  return (
    <form onSubmit={save} noValidate className="space-y-3 rounded-card border border-line bg-white p-4" aria-label="New booking">
      <div className="flex items-center justify-between"><p className="text-sm font-bold text-ink-900">New booking</p><button type="button" onClick={onCancel} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-control hover:bg-canvas"><X className="h-4 w-4 text-ink-400" /></button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] font-semibold text-ink-700">Customer&apos;s WhatsApp number<input id="bk-phone" required value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} onBlur={() => f.phone && setTried(true)} placeholder="91 98765 43210" inputMode="tel" aria-invalid={!!show("phone")} aria-describedby={show("phone") ? "bk-phone-err" : undefined} className={`${inp} mt-1 w-full ${show("phone") ? "border-red-400" : ""}`} />
          {show("phone") && <span id="bk-phone-err" className="mt-1 block text-[12px] font-normal text-red-700">{show("phone")}</span>}</label>
        <label className="text-[12px] font-semibold text-ink-700">Name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={`${inp} mt-1 w-full`} /></label>
        <label className="text-[12px] font-semibold text-ink-700">Service
          <select value={f.serviceId} onChange={e => setF({ ...f, serviceId: e.target.value })} className={`${inp} mt-1 w-full`}>
            <option value="">General appointment</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min{s.priceCents ? ` · ${rupees(s.priceCents)}` : ""}</option>)}
          </select>
        </label>
        <label className="text-[12px] font-semibold text-ink-700">With
          <select value={f.staffId} onChange={e => setF({ ...f, staffId: e.target.value })} className={`${inp} mt-1 w-full`}>
            <option value="">Anyone</option>
            {setup.staff.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-[12px] font-semibold text-ink-700">Date and time<input id="bk-at" type="datetime-local" required value={f.at} onChange={e => setF({ ...f, at: e.target.value })} aria-invalid={!!show("at")} aria-describedby={show("at") ? "bk-at-err" : undefined} className={`${inp} mt-1 w-full ${show("at") ? "border-red-400" : ""}`} />
          {show("at") && <span id="bk-at-err" className="mt-1 block text-[12px] font-normal text-red-700">{show("at")}</span>}</label>
        {!f.serviceId && <label className="text-[12px] font-semibold text-ink-700">Length (minutes)<input id="bk-min" type="number" min={5} max={720} value={f.minutes} onChange={e => setF({ ...f, minutes: Number(e.target.value) })} aria-invalid={!!show("minutes")} aria-describedby={show("minutes") ? "bk-min-err" : undefined} className={`${inp} mt-1 w-full ${show("minutes") ? "border-red-400" : ""}`} />
          {show("minutes") && <span id="bk-min-err" className="mt-1 block text-[12px] font-normal text-red-700">{show("minutes")}</span>}</label>}
      </div>
      <label className="block text-[12px] font-semibold text-ink-700">Notes<input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className={`${inp} mt-1 w-full`} /></label>
      {err && <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-10 px-3 text-xs font-semibold text-ink-600">Cancel</button><button disabled={saving} className="min-h-10 rounded-control bg-brand-700 px-4 text-xs font-bold text-white disabled:opacity-50">{saving ? "Adding…" : "Add booking"}</button></div>
    </form>
  );
}

type BookingProblems = Partial<Record<"phone" | "at" | "minutes", string>>;

/** What's missing or wrong in the new-booking form, field by field — shown next to each field. */
export function bookingProblems(f: { phone: string; at: string; minutes: number; serviceId: string }): BookingProblems {
  const out: BookingProblems = {};
  const digits = f.phone.replace(/\D/g, "");
  if (!digits) out.phone = "Enter the customer's WhatsApp number.";
  else if (digits.length < 10) out.phone = "That number looks too short — include the country code, e.g. 91 98765 43210.";
  if (!f.at || Number.isNaN(new Date(f.at).getTime())) out.at = "Choose the date and time.";
  if (!f.serviceId && (!Number.isFinite(f.minutes) || f.minutes < 5 || f.minutes > 720)) out.minutes = "Between 5 and 720 minutes.";
  return out;
}

function SetupPanel({ setup, onChange, onClose }: { setup: Setup; onChange: () => Promise<void>; onClose: () => void }) {
  const [svc, setSvc] = useState({ name: "", minutes: 30, price: "", deposit: "" });
  const [staff, setStaff] = useState({ name: "", userId: "" });
  const [rem, setRem] = useState(setup.settings.reminder);
  const [err, setErr] = useState<string | null>(null);
  const post = async (body: unknown, done: string) => {
    setErr(null);
    const r = await fetch("/api/admin/bookings/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't save. Please try again."); return false; }
    toast(done);
    await onChange(); return true;
  };
  const cents = (s: string) => Math.round(Number(s || 0) * 100);
  return (
    <section className="space-y-4 rounded-card border border-line bg-white p-4" aria-label="Services, staff and reminders">
      <div className="flex items-center justify-between"><p className="text-sm font-bold text-ink-900">Services, staff and reminders</p><button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-control hover:bg-canvas"><X className="h-4 w-4 text-ink-400" /></button></div>
      {err && <p role="alert" className="text-[12px] text-red-600">{err}</p>}
      <div className="space-y-2">
        <p className="text-[12px] font-bold text-ink-700">Services</p>
        {!setup.services.length && <p className="text-[12px] text-ink-500">No services yet. Add what customers can book — a name, how long it takes and the price — so the AI and your team offer the right slot.</p>}
        {setup.services.map(s => <p key={s.id} className="text-[12px] text-ink-700">{s.name} · {s.durationMinutes} min{s.priceCents ? ` · ${rupees(s.priceCents)}` : ""}{s.depositCents ? ` · deposit ${rupees(s.depositCents)}` : ""}{!s.active && " (hidden)"}</p>)}
        <form onSubmit={async e => { e.preventDefault(); if (await post({ service: { name: svc.name, durationMinutes: svc.minutes, priceCents: cents(svc.price), depositCents: cents(svc.deposit) } }, `${svc.name} added`)) setSvc({ name: "", minutes: 30, price: "", deposit: "" }); }} className="flex flex-wrap gap-1.5">
          <input required value={svc.name} onChange={e => setSvc({ ...svc, name: e.target.value })} placeholder="Haircut" className={`${inp} py-1`} aria-label="Service name" />
          <input type="number" min={5} max={720} value={svc.minutes} onChange={e => setSvc({ ...svc, minutes: Number(e.target.value) })} className={`${inp} w-20 py-1`} aria-label="Minutes" />
          <input value={svc.price} onChange={e => setSvc({ ...svc, price: e.target.value })} placeholder="Price ₹" className={`${inp} w-24 py-1`} aria-label="Price in rupees" />
          <input value={svc.deposit} onChange={e => setSvc({ ...svc, deposit: e.target.value })} placeholder="Deposit ₹" className={`${inp} w-24 py-1`} aria-label="Deposit in rupees" />
          <button className="min-h-8 rounded-control bg-brand-700 px-2.5 py-1 text-[12px] font-bold text-white">Add service</button>
        </form>
      </div>
      <div className="space-y-2">
        <p className="text-[12px] font-bold text-ink-700">Staff</p>
        {!setup.staff.length && <p className="text-[12px] text-ink-500">No staff yet. Add the people customers book with, so each booking shows who they&apos;re seeing.</p>}
        {setup.staff.map(s => <p key={s.id} className="text-[12px] text-ink-700">{s.name}{s.userId ? ` · ${setup.team.find(t => t.id === s.userId)?.name ?? "a teammate"} sees their bookings` : ""}</p>)}
        <form onSubmit={async e => { e.preventDefault(); if (await post({ staff: { name: staff.name, userId: staff.userId || null } }, `${staff.name} added`)) setStaff({ name: "", userId: "" }); }} className="flex flex-wrap gap-1.5">
          <input required value={staff.name} onChange={e => setStaff({ ...staff, name: e.target.value })} placeholder="Name" className={`${inp} py-1`} aria-label="Staff name" />
          <select value={staff.userId} onChange={e => setStaff({ ...staff, userId: e.target.value })} className={`${inp} py-1`} aria-label="Their Talko login">
            <option value="">No Talko login</option>
            {setup.team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="min-h-8 rounded-control bg-brand-700 px-2.5 py-1 text-[12px] font-bold text-white">Add staff</button>
        </form>
      </div>
      <div className="space-y-2 rounded-control bg-canvas p-3">
        <label className="flex items-start gap-2 text-[13px] text-ink-800"><input type="checkbox" checked={rem.enabled} onChange={e => setRem({ ...rem, enabled: e.target.checked })} className="mt-0.5" />
          <span><b>Remind customers before their booking</b> — one WhatsApp message. If the customer messaged you within the last 24 hours it goes as a normal message; otherwise WhatsApp needs an approved template.</span></label>
        {rem.enabled && (
          <div className="flex flex-wrap items-center gap-2 pl-6 text-[12px] text-ink-700">
            <select value={rem.hoursBefore} onChange={e => setRem({ ...rem, hoursBefore: Number(e.target.value) })} className={`${inp} py-1`}>{[1, 2, 3, 6, 12, 24].map(hh => <option key={hh} value={hh}>{hh} hour{hh === 1 ? "" : "s"} before</option>)}</select>
            <input value={rem.template?.name ?? ""} onChange={e => setRem({ ...rem, template: e.target.value ? { name: e.target.value, language: rem.template?.language ?? "en" } : null })} placeholder="Template name (optional)" className={`${inp} py-1`} aria-label="Reminder template name" />
            <span className="text-ink-500">Template variables: {"{{1}}"} = name, {"{{2}}"} = date and time.</span>
          </div>
        )}
        <button onClick={() => void post({ settings: { reminder: rem } }, "Reminder settings saved")} className="min-h-8 rounded-control bg-brand-700 px-2.5 py-1 text-[12px] font-bold text-white">Save reminders</button>
      </div>
    </section>
  );
}
