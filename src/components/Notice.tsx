"use client";

// The result of an action, shown with its tone: done, needs attention, failed,
// or still working.
//
// Screens used to keep one message string and pick its colour at the render
// site. Every success, warning and error then looked the same: Instagram showed
// "@account is connected and receiving." in red under a warning icon, Forms
// showed "Meta flagged…" in calm brand blue, and two cards guessed the colour by
// searching the text for words like "fail". The tone now travels with the
// message from the line that knows what happened.
import { useCallback, useState } from "react";
import { AlertTriangle, CircleCheck, Info, X } from "lucide-react";

export type Tone = "ok" | "warn" | "error" | "info";
export interface NoticeState { text: string; tone: Tone }

/**
 * `say(text, tone)` sets the message; `say(null)` clears it. The tone defaults to
 * "error" because almost every bare message on these screens is a validation or
 * request failure. Mark success, warnings and progress explicitly.
 */
export function useNotice(): [NoticeState | null, (text: string | null | undefined, tone?: Tone) => void] {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const say = useCallback((text: string | null | undefined, tone: Tone = "error") => setNotice(text ? { text, tone } : null), []);
  return [notice, say];
}

const STYLE: Record<Tone, { box: string; text: string; icon: string }> = {
  ok:    { box: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", icon: "text-emerald-600" },
  warn:  { box: "bg-amber-50 border-amber-200",     text: "text-amber-800",   icon: "text-amber-600" },
  error: { box: "bg-red-50 border-red-200",         text: "text-red-700",     icon: "text-red-600" },
  info:  { box: "bg-slate-50 border-line",          text: "text-slate-600",   icon: "text-slate-400" },
};
const ICON = { ok: CircleCheck, warn: AlertTriangle, error: AlertTriangle, info: Info } as const;

/**
 * `inline` is a single line under a form or button; `banner` is a boxed message
 * at the top of a card, dismissable when `onClose` is given.
 */
export function Notice({ notice, variant = "inline", onClose, className = "" }: {
  notice: NoticeState | null;
  variant?: "inline" | "banner";
  onClose?: () => void;
  className?: string;
}) {
  if (!notice) return null;
  const s = STYLE[notice.tone];
  const Icon = ICON[notice.tone];
  const role = notice.tone === "error" ? "alert" : "status";
  if (variant === "inline") {
    return (
      <p role={role} className={`text-xs leading-snug flex items-start gap-1.5 ${s.text} ${notice.tone === "ok" ? "font-semibold" : ""} ${className}`}>
        <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${s.icon}`} aria-hidden />
        <span className="min-w-0">{notice.text}</span>
      </p>
    );
  }
  return (
    <div role={role} className={`rounded-control border px-3 py-2.5 flex items-start gap-2 u-fade-in ${s.box} ${className}`}>
      <Icon className={`w-4 h-4 shrink-0 ${s.icon}`} aria-hidden />
      <p className={`flex-1 min-w-0 text-xs leading-snug ${s.text} ${notice.tone === "ok" ? "font-semibold" : ""}`}>{notice.text}</p>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="p-0.5 -m-0.5 rounded text-slate-400 hover:text-ink-900">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
