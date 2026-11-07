"use client";

// Review requests (review-booster.ts): ask customers for a Google review on
// WhatsApp after a paid order, after a completed service reported by a
// connected tool, or by hand — plus a printable QR code for each location.
// Hidden for anyone the API refuses (members, or a plan without Google Reviews).

import { useCallback, useEffect, useState } from "react";
import { Star, Loader2, ChevronDown, QrCode, Printer } from "lucide-react";
import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { inp } from "../_shared";
import { toast } from "@/components/toast";

interface Config {
  enabled: boolean; locationId: string | null; reviewUrl: string;
  triggers: { paidOrder: boolean; events: string[] }; delayMinutes: number; message: string;
  template: { name: string; language: string } | null; frequencyDays: number;
  quietHours: { start: number; end: number } | null; reminder: { enabled: boolean; afterHours: number };
}
interface Stats { scheduled: number; sent: number; opened: number; skipped: number; failed: number; cancelled: number; recent: { phoneTail: string; name: string | null; status: string; source: string; detail: string | null; at: string; clickedAt: string | null }[]; setupNeeded?: string }
interface Data {
  config: Config; stats: Stats; locations: { id: string; name: string; reviewUri: string | null }[];
  templates: { name: string; language: string; category: string; usable: boolean; why: string | null }[];
  whatsappConnected: boolean; eventSuggestions: { key: string; label: string }[]; reviewUrl: string; preview: string;
}

const DELAYS = [{ v: 15, l: "15 minutes" }, { v: 30, l: "30 minutes" }, { v: 60, l: "1 hour" }, { v: 120, l: "2 hours" }, { v: 360, l: "6 hours" }, { v: 1440, l: "1 day" }, { v: 2880, l: "2 days" }];
const STATUS_LABEL: Record<string, string> = { scheduled: "Waiting", sending: "Sending", sent: "Sent", skipped: "Not sent", failed: "Failed", cancelled: "Cancelled" };
const hour = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;

export function ReviewBooster() {
  const [d, setD] = useState<Data | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [dirty, setDirty] = useState(false);
  const [customEvent, setCustomEvent] = useState("");
  const [note, say] = useNotice();

  const load = useCallback(async (keepEdits = false) => {
    const r = await fetch("/api/admin/review-booster").catch(() => null);
    if (!r?.ok) { setHidden(true); return; }
    const j = (await r.json()) as Data;
    setD(j);
    if (!keepEdits) { setCfg(j.config); setDirty(false); }
    setHidden(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (hidden || !cfg || !d) return null;

  async function post(body: Record<string, unknown>, done: (j: Record<string, unknown>) => string): Promise<boolean> {
    setBusy(true); say(null);
    const r = await fetch("/api/admin/review-booster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok || j.error) { say(j.error || "That didn't work. Please try again."); return false; }
    const bad = j.status && j.status !== "sent" && j.status !== "scheduled";
    if (bad) say(done(j), "warn"); else toast(done(j));
    load(bad);
    return true;
  }
  const edit = (patch: Partial<Config>) => { setCfg({ ...cfg, ...patch }); setDirty(true); };
  const save = () => post({ action: "save", config: cfg }, () => (cfg.enabled ? "Saved — review requests are on" : "Review request settings saved"));
  async function send() {
    if (dirty && !(await save())) return;
    await post({ action: "send", phone }, j => j.status === "sent" ? "Review request sent on WhatsApp" : String(j.detail ?? j.status));
  }
  function printQr(loc: { id: string; name: string }) {
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    w.document.write(`<!doctype html><title>Review ${esc(loc.name)} on Google</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#111"><h1 style="font-size:28px;margin:0 0 8px">Enjoyed ${esc(loc.name)}?</h1><p style="font-size:18px;margin:0 0 24px">Scan to share your experience on Google</p><img src="/api/admin/review-booster/qr?location=${encodeURIComponent(loc.id)}" style="width:320px;height:320px" onload="setTimeout(()=>print(),200)"/><p style="font-size:14px;color:#555;margin-top:24px">Thank you for your feedback — good or bad, it helps us improve.</p></body>`);
    w.document.close();
  }

  const s = d.stats;
  const tplChoice = cfg.template ? `${cfg.template.name}|${cfg.template.language}` : "";
  return (
    <details className="group rounded-card border border-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-700">
          <Star className="h-3.5 w-3.5 text-ink-400" /> Review requests
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.enabled ? "bg-emerald-50 text-emerald-700" : "bg-canvas text-ink-500"}`}>{cfg.enabled ? "On" : "Off"}</span>
          {s.sent > 0 && <span className="text-[11px] font-normal text-ink-500 tabular-nums">{s.sent} sent in 30 days</span>}
        </span>
        <ChevronDown className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" />
      </summary>
      <section className="space-y-5 border-t border-line p-4">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold text-ink-700">Invite customers to review you on Google</p>
          <PageInfo>One WhatsApp message with a link to your Google review page, and a private way to tell you if something wasn&apos;t right. Everyone eligible is asked the same way — Google doesn&apos;t allow asking only happy customers, or offering anything in return for a review.</PageInfo>
        </div>
        {s.setupNeeded && <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{s.setupNeeded}</p>}
        {!d.whatsappConnected && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">Connect a WhatsApp number first — requests are sent from it.</p>}

        <div className="space-y-2">
          <p className="text-[11px] font-bold text-ink-500 uppercase tracking-wide">Review link</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-ink-700 space-y-1.5 block">
              <span>Location</span>
              <select className={`${inp} w-full`} value={cfg.locationId ?? ""} onChange={e => edit({ locationId: e.target.value || null })}>
                <option value="">None — use the link below</option>
                {d.locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.reviewUri ? "" : " (link not available yet)"}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink-700 space-y-1.5 block">
              <span>Or paste a Google review link</span>
              <input className={`${inp} w-full`} placeholder="https://g.page/r/…/review" value={cfg.reviewUrl} onChange={e => edit({ reviewUrl: e.target.value })} />
            </label>
          </div>
          <p className="text-[11px] text-ink-500">{d.reviewUrl ? <>Customers go to <span className="break-all">{d.reviewUrl}</span></> : "No review link yet."} Mezvaan bills use each outlet&apos;s own link.</p>
          {d.locations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.locations.filter(l => l.reviewUri).map(l => (
                <span key={l.id} className="inline-flex items-center gap-1">
                  <a href={`/api/admin/review-booster/qr?location=${encodeURIComponent(l.id)}`} download={`${l.name}-review-qr.png`} className="inline-flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-700 hover:bg-canvas"><QrCode className="h-3.5 w-3.5" /> QR for {l.name}</a>
                  <button type="button" onClick={() => printQr(l)} className="grid h-8 w-8 place-items-center rounded-control border border-line text-ink-500 hover:bg-canvas" title={`Print a QR card for ${l.name}`} aria-label={`Print a QR card for ${l.name}`}><Printer className="h-3.5 w-3.5" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-bold text-ink-500 uppercase tracking-wide">When to ask</p>
          <label className="flex items-center gap-2 text-[13px] text-ink-700"><input type="checkbox" className="accent-brand-700" checked={cfg.triggers.paidOrder} onChange={e => edit({ triggers: { ...cfg.triggers, paidOrder: e.target.checked } })} /> After a paid order in Talko</label>
          {d.eventSuggestions.map(ev => (
            <label key={ev.key} className="flex items-center gap-2 text-[13px] text-ink-700">
              <input type="checkbox" className="accent-brand-700" checked={cfg.triggers.events.includes(ev.key)} onChange={e => edit({ triggers: { ...cfg.triggers, events: e.target.checked ? [...cfg.triggers.events, ev.key] : cfg.triggers.events.filter(x => x !== ev.key) } })} />
              After: {ev.label}
            </label>
          ))}
          {cfg.triggers.events.filter(e => !d.eventSuggestions.some(s2 => s2.key === e)).map(e => (
            <label key={e} className="flex items-center gap-2 text-[13px] text-ink-700"><input type="checkbox" className="accent-brand-700" checked onChange={() => edit({ triggers: { ...cfg.triggers, events: cfg.triggers.events.filter(x => x !== e) } })} /> After the event <code className="text-[12px]">{e}</code></label>
          ))}
          <div className="flex gap-2">
            <input className={`${inp} flex-1 min-w-0`} placeholder="Another event from your tools, e.g. appointment.completed" value={customEvent} onChange={e => setCustomEvent(e.target.value)} aria-label="Custom event name" />
            <button type="button" disabled={!/^[a-z0-9_.:-]{2,80}$/i.test(customEvent.trim())} onClick={() => { edit({ triggers: { ...cfg.triggers, events: [...new Set([...cfg.triggers.events, customEvent.trim()])] } }); setCustomEvent(""); }} title={!/^[a-z0-9_.:-]{2,80}$/i.test(customEvent.trim()) ? "Type the event name first — letters, numbers, dots or dashes, no spaces" : undefined} className="min-h-9 rounded-control border border-line px-3 text-xs font-semibold text-ink-700 disabled:opacity-50">Add</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-ink-700 space-y-1.5 block">
              <span>Wait before asking</span>
              <select className={`${inp} w-full`} value={cfg.delayMinutes} onChange={e => edit({ delayMinutes: Number(e.target.value) })}>
                {DELAYS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                {!DELAYS.some(o => o.v === cfg.delayMinutes) && <option value={cfg.delayMinutes}>{cfg.delayMinutes} minutes</option>}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink-700 space-y-1.5 block">
              <span>Ask the same customer at most once every</span>
              <select className={`${inp} w-full`} value={cfg.frequencyDays} onChange={e => edit({ frequencyDays: Number(e.target.value) })}>
                {[7, 14, 30, 60, 90, 180].map(n => <option key={n} value={n}>{n} days</option>)}
                <option value={0}>No limit</option>
              </select>
            </label>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
            <input type="checkbox" className="accent-brand-700" checked={!!cfg.quietHours} onChange={e => edit({ quietHours: e.target.checked ? { start: 21, end: 9 } : null })} /> Don&apos;t send between
            {cfg.quietHours && <>
              <select aria-label="Quiet hours start" className={`${inp} w-24`} value={cfg.quietHours.start} onChange={e => edit({ quietHours: { ...cfg.quietHours!, start: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}</select>
              and
              <select aria-label="Quiet hours end" className={`${inp} w-24`} value={cfg.quietHours.end} onChange={e => edit({ quietHours: { ...cfg.quietHours!, end: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}</select>
            </>}
          </label>
          <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
            <input type="checkbox" className="accent-brand-700" checked={cfg.reminder.enabled} onChange={e => edit({ reminder: { ...cfg.reminder, enabled: e.target.checked } })} /> Send one reminder if the link isn&apos;t opened after
            <input type="number" min={2} max={23} className={`${inp} w-16`} value={cfg.reminder.afterHours} onChange={e => edit({ reminder: { ...cfg.reminder, afterHours: Number(e.target.value) } })} aria-label="Reminder after hours" /> hours
            <span className="basis-full text-[11px] text-ink-500">Only while WhatsApp still allows a normal message (within 24 hours of the customer&apos;s last message).</span>
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-bold text-ink-500 uppercase tracking-wide">Message</p>
          <textarea className={`${inp} w-full`} rows={2} maxLength={600} value={cfg.message} onChange={e => edit({ message: e.target.value })} aria-label="Request message" />
          <div className="rounded-control border border-line bg-canvas/60 px-3 py-2 text-[12px] text-ink-700 whitespace-pre-wrap" aria-label="Message preview"><span className="block text-[11px] font-bold uppercase text-ink-500">Preview</span>{`${cfg.message}\n\n⭐ https://app.thetalko.in/r/rv/…\n\nSomething not right? Just reply here and we'll put it right.`}</div>
          <label className="text-xs font-semibold text-ink-700 space-y-1.5 block">
            <span>Approved message for customers who haven&apos;t messaged you in the last 24 hours</span>
            <select className={`${inp} w-full`} value={tplChoice} onChange={e => { const [name, language] = e.target.value.split("|"); edit({ template: name ? { name, language } : null }); }}>
              <option value="">None — only ask customers who messaged in the last 24 hours</option>
              {d.templates.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!t.usable}>{t.name} ({t.language}, {t.category.toLowerCase()}){t.usable ? "" : " — no place for the link"}</option>)}
            </select>
            <span className="block font-normal text-ink-500">Use an approved template whose text has {"{{1}}"} where the review link goes. A marketing template only reaches customers who opted in.</span>
          </label>
        </div>

        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
          <input type="checkbox" className="accent-brand-700" checked={cfg.enabled} onChange={e => edit({ enabled: e.target.checked })} /> Send review requests automatically
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={busy} className="min-h-9 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 inline-flex items-center gap-1.5">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save{dirty ? " changes" : ""}</button>
          <span className="text-[11px] text-ink-500">or ask one customer now:</span>
          <input className={`${inp} w-44`} placeholder="98XXXXXXXX" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} aria-label="Customer WhatsApp number" />
          <button onClick={send} disabled={busy || phone.replace(/\D/g, "").length < 10} title={phone.replace(/\D/g, "").length < 10 ? "Enter the customer's 10-digit WhatsApp number first" : undefined} className="min-h-9 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas disabled:opacity-60">Send request</button>
        </div>
        <Notice notice={note} onClose={() => say(null)} />

        <div className="space-y-1.5">
          <p className="text-[12px] text-ink-600 tabular-nums">
            Last 30 days: <b className="text-ink-900">{s.sent}</b> sent · <b className="text-ink-900">{s.opened}</b> opened the review link · {s.scheduled} waiting · {s.skipped} not sent · {s.failed} failed
          </p>
          <p className="text-[11px] text-ink-500">Opening the link doesn&apos;t mean a review was written — Google doesn&apos;t tell Talko that.</p>
          {s.recent.length > 0 && (
            <ul className="divide-y divide-line rounded-control border border-line text-[12px]">
              {s.recent.slice(0, 8).map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 px-3 py-1.5">
                  <span className="font-semibold text-ink-800">{r.name || `…${r.phoneTail}`}</span>
                  <span className="text-ink-500">{STATUS_LABEL[r.status] ?? r.status}{r.clickedAt ? " · opened" : ""}</span>
                  <span className="text-ink-400 tabular-nums">{new Date(r.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  {r.detail && r.status !== "sent" && <span className="basis-full text-[11px] text-ink-500">{r.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </details>
  );
}
