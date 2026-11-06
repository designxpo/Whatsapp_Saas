"use client";

// The top bar's bell: how many chats are waiting for a person, which ones, and
// the two switches for being told (src/lib/use-inbox-alerts.ts).
//
// A small panel anchored to the bell rather than a side panel: it is a glance
// and two switches, not a form. It grows out of the bell (the panel scales
// from its top-right corner, where the bell is) and closes on Escape, on a
// click outside, or on picking a chat — which opens that chat in Live Chat.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, BellOff } from "lucide-react";
import { channelShort } from "@/lib/channel-label";
import { fmtAgo } from "@/lib/format";
import { usePresence } from "@/lib/use-presence";
import type { useInboxAlerts, WaitingChat, ReviewBellAlert } from "@/lib/use-inbox-alerts";

type Alerts = ReturnType<typeof useInboxAlerts>;

// Shared vocabulary: "Needs a person" (not "escalated"), "AI paused" (not "bot off").
const REASON: Record<WaitingChat["reason"], string> = {
  escalated: "Needs a person",
  bot_off: "AI paused — a person is handling it",
  ai_off: "AI replies are off",
  unanswered: "No reply yet",
  ready_to_pay: "Ready to pay — close the sale",
  approval: "Discount or refund needs your approval",
};

const ago = (iso: string) => fmtAgo(iso);

/** What the bell's button is called: its count in words ("3 notifications"). */
export function bellLabel(waiting: number, reviews: number): string {
  const n = waiting + reviews;
  return n === 0 ? "Notifications" : `${n} notification${n === 1 ? "" : "s"}`;
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? "bg-brand-600" : "bg-slate-400"}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

export function AlertsBell({ alerts, onOpen, onOpenReview, onOpenAll }: { alerts: Alerts; onOpen: (chat: WaitingChat) => void; onOpenReview?: (a: ReviewBellAlert) => void; onOpenAll?: () => void }) {
  const [open, setOpen] = useState(false);
  const { mounted, shown } = usePresence(open, 140);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const reviews = alerts.reviewAlerts ?? [];
  const n = alerts.count + reviews.length;
  const blocked = alerts.permission === "denied";
  const unsupported = alerts.permission === "unsupported";

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={bellLabel(alerts.count, reviews.length)}
        data-help="Chats waiting for you and review updates, and how you're told about them."
        className="relative inline-flex items-center justify-center w-10 h-10 rounded-full border border-line bg-white text-ink-600 hover:bg-canvas hover:text-ink-900 transition-colors">
        {alerts.sound || alerts.desktop ? <Bell className="w-4 h-4" aria-hidden /> : <BellOff className="w-4 h-4" aria-hidden />}
        {n > 0 && (
          <span aria-hidden className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center tabular-nums">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>

      {mounted && (
        <div role="dialog" aria-label="Notifications" {...(shown ? { "data-shown": "" } : {})}
          className="ov-pop absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-1.5rem)] bg-white rounded-card border border-line shadow-float z-30 overflow-hidden">
          <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-ink-900">Waiting for you</p>
              <p className="text-[12px] text-ink-500">{alerts.count ? `${alerts.count} chat${alerts.count === 1 ? "" : "s"} need${alerts.count === 1 ? "s" : ""} a person` : reviews.length ? "No chats waiting." : "Nothing waiting. Chats that need a person show up here."}</p>
            </div>
            {onOpenAll && alerts.count > 0 && (
              <button type="button" onClick={() => { setOpen(false); onOpenAll(); }} className="shrink-0 min-h-8 inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 hover:underline">
                See all <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </button>
            )}
          </div>
          {alerts.chats.length > 0 && (
            <ul className="max-h-72 overflow-y-auto overscroll-contain border-t border-line">
              {alerts.chats.slice(0, 8).map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => { setOpen(false); onOpen(c); }} className="no-press w-full text-left px-4 py-2.5 hover:bg-canvas border-b border-line last:border-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-ink-900 truncate">{c.name || c.phone}</span>
                      <span className="text-[12px] text-ink-500 shrink-0">{channelShort(c.platform)} · {ago(c.lastInboundAt)}</span>
                    </span>
                    <span className="block text-[12px] text-ink-500">{REASON[c.reason]}</span>
                    {c.preview && <span className="block text-[12px] text-ink-600 truncate mt-0.5">{c.preview}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {reviews.length > 0 && (
            <div className="border-t border-line">
              <p className="px-4 pt-2.5 pb-1 text-[11px] font-bold text-ink-500 uppercase tracking-wide">Reviews</p>
              <ul className="max-h-56 overflow-y-auto overscroll-contain">
                {reviews.slice(0, 6).map(a => (
                  <li key={a.id}>
                    <button type="button" onClick={() => { setOpen(false); onOpenReview?.(a); }} className="no-press w-full text-left px-4 py-2 hover:bg-canvas border-b border-line last:border-0">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-ink-900 line-clamp-2">{a.title}</span>
                        <span className="text-[12px] text-ink-500 shrink-0">{ago(a.createdAt)}</span>
                      </span>
                      {a.body && <span className="block text-[12px] text-ink-600 truncate mt-0.5">{a.body}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="border-t border-line bg-canvas/60 px-4 py-3 space-y-2.5">
            <label className="flex items-center justify-between gap-3 text-[13px] text-ink-900">
              <span>Play a sound</span>
              <Switch on={alerts.sound} onChange={alerts.setSound} label="Play a sound for chats that need a person" />
            </label>
            <label className="flex items-center justify-between gap-3 text-[13px] text-ink-900">
              <span>Desktop notifications<span className="block text-[12px] text-ink-500">While the portal is in the background</span></span>
              <Switch on={alerts.desktop} onChange={v => void alerts.setDesktop(v)} disabled={blocked || unsupported} label="Desktop notifications while the portal is in the background" />
            </label>
            {blocked && <p className="text-[12px] text-amber-700">Blocked by this browser. Allow notifications for this site in the browser&apos;s site settings, then switch this on.</p>}
            {unsupported && <p className="text-[12px] text-ink-500">This browser can&apos;t show desktop notifications.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
