"use client";

// Short confirmations after an action ("Saved", "Booking cancelled") with an
// optional Undo, announced to screen readers. Call `toast()` from anywhere in
// the portal; <Toaster /> (mounted once in the admin shell) shows them.

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export type ToastTone = "ok" | "error" | "info";
export interface ToastInput { text: string; tone?: ToastTone; action?: { label: string; onClick: () => void }; ms?: number }
interface Shown extends Required<Pick<ToastInput, "text" | "tone" | "ms">> { id: number; action?: ToastInput["action"] }

type Listener = (t: Shown) => void;
const listeners = new Set<Listener>();
let seq = 0;

/** Show a toast. Errors stay longer; an Undo keeps it up long enough to reach. */
export function toast(input: string | ToastInput): void {
  const t = typeof input === "string" ? { text: input } : input;
  const tone = t.tone ?? "ok";
  const shown: Shown = { id: ++seq, text: t.text, tone, action: t.action, ms: t.ms ?? (t.action ? 8000 : tone === "error" ? 7000 : 4000) };
  for (const l of listeners) l(shown);
}

const ICON: Record<ToastTone, React.ReactNode> = {
  ok: <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden />,
  error: <AlertTriangle className="w-4 h-4 text-red-400" aria-hidden />,
  info: <Info className="w-4 h-4 text-sky-300" aria-hidden />,
};

export function Toaster() {
  const [items, setItems] = useState<Shown[]>([]);
  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const add: Listener = t => {
      setItems(list => [...list.slice(-2), t]);
      timers.set(t.id, setTimeout(() => setItems(list => list.filter(x => x.id !== t.id)), t.ms));
    };
    listeners.add(add);
    return () => { listeners.delete(add); for (const t of timers.values()) clearTimeout(t); };
  }, []);
  const close = (id: number) => setItems(list => list.filter(x => x.id !== id));
  return (
    <div className="fixed inset-x-0 bottom-20 lg:bottom-6 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" role="status" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 max-w-md w-full sm:w-auto rounded-xl bg-ink-950 text-white text-sm px-4 py-3 shadow-2xl">
          {ICON[t.tone]}
          <span className="flex-1 min-w-0">{t.text}</span>
          {t.action && (
            <button type="button" className="shrink-0 min-h-8 px-2 rounded-md font-semibold text-sky-300 hover:bg-white/10"
              onClick={() => { t.action!.onClick(); close(t.id); }}>{t.action.label}</button>
          )}
          <button type="button" aria-label="Dismiss" className="shrink-0 grid place-items-center w-8 h-8 -mr-1 rounded-md text-white/70 hover:bg-white/10" onClick={() => close(t.id)}>
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
