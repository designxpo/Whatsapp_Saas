"use client";

// The top bar's bell: how many chats are waiting for a person, which ones, and
// the two switches for being told (src/lib/use-inbox-alerts.ts).
//
// A small panel anchored to the bell rather than a side panel: it is a glance
// and two switches, not a form. It grows out of the bell (the panel scales
// from its top-right corner, where the bell is) and closes on Escape, on a
// click outside, or on picking a chat — which opens that chat in Live Chat.

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { channelShort } from "@/lib/channel-label";
import { usePresence } from "@/lib/use-presence";
import type { useInboxAlerts, WaitingChat } from "@/lib/use-inbox-alerts";

type Alerts = ReturnType<typeof useInboxAlerts>;

const REASON: Record<WaitingChat["reason"], string> = {
  escalated: "Handed to your team",
  bot_off: "A person is handling it",
  ai_off: "AI replies are off",
  unanswered: "No reply yet",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? "bg-brand-600" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

export function AlertsBell({ alerts, onOpen }: { alerts: Alerts; onOpen: (chat: WaitingChat) => void }) {
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

  const n = alerts.count;
  const blocked = alerts.permission === "denied";
  const unsupported = alerts.permission === "unsupported";

  return (
    <div ref={wrap} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={n ? `Alerts: ${n} chat${n === 1 ? "" : "s"} waiting for a person` : "Alerts"}
        data-help="Chats waiting for a person, and how you're told about them."
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-control border border-line text-ink-600 hover:bg-canvas hover:text-ink-900 transition-colors">
        {alerts.sound || alerts.desktop ? <Bell className="w-4 h-4" aria-hidden /> : <BellOff className="w-4 h-4" aria-hidden />}
        {n > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center tabular-nums">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>

      {mounted && (
        <div role="dialog" aria-label="Chats waiting for a person" {...(shown ? { "data-shown": "" } : {})}
          className="ov-pop absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-2rem)] bg-white rounded-card border border-line shadow-float z-30 overflow-hidden">
          <div className="px-4 pt-3.5 pb-2">
            <p className="text-sm font-extrabold text-ink-900">Waiting for your team</p>
            <p className="text-[11px] text-ink-400">{n ? `${n} chat${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} a person` : "Nothing waiting. Chats that need a person show up here."}</p>
          </div>
          {alerts.chats.length > 0 && (
            <ul className="max-h-72 overflow-y-auto overscroll-contain border-t border-line">
              {alerts.chats.slice(0, 8).map(c => (
                <li key={c.id}>
                  <button onClick={() => { setOpen(false); onOpen(c); }} className="no-press w-full text-left px-4 py-2.5 hover:bg-canvas border-b border-line last:border-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-ink-900 truncate">{c.name || c.phone}</span>
                      <span className="text-[11px] text-ink-400 shrink-0">{channelShort(c.platform)} · {ago(c.lastInboundAt)}</span>
                    </span>
                    <span className="block text-[11px] text-ink-400">{REASON[c.reason]}</span>
                    {c.preview && <span className="block text-[12px] text-ink-600 truncate mt-0.5">{c.preview}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line bg-canvas/60 px-4 py-3 space-y-2.5">
            <label className="flex items-center justify-between gap-3 text-[13px] text-ink-900">
              <span>Play a sound</span>
              <Switch on={alerts.sound} onChange={alerts.setSound} label="Play a sound for chats that need a person" />
            </label>
            <label className="flex items-center justify-between gap-3 text-[13px] text-ink-900">
              <span>Desktop notifications<span className="block text-[11px] text-ink-400">While the portal is in the background</span></span>
              <Switch on={alerts.desktop} onChange={v => void alerts.setDesktop(v)} disabled={blocked || unsupported} label="Desktop notifications while the portal is in the background" />
            </label>
            {blocked && <p className="text-[11px] text-amber-700">Blocked by this browser. Allow notifications for this site in the browser&apos;s site settings, then switch this on.</p>}
            {unsupported && <p className="text-[11px] text-ink-400">This browser can&apos;t show desktop notifications.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
