"use client";

// One confirmation dialog for every action with real consequences.
//
// Two problems it replaces. First, the biggest button in the product had no
// guard at all: "Send broadcast" fired straight from the click, and a misclick
// put a marketing template in front of every contact in the workspace — an
// action with no undo, a per-message cost, and a Meta quality score attached to
// it. Second, the ~27 places that DID ask used window.confirm(), which renders
// differently on every OS, cannot show the facts of what is about to happen,
// and trains people to dismiss it without reading.
//
// The dialog is deliberately imperative — `if (!(await ask({...}))) return;` —
// so it drops straight into the shape the old code already had, rather than
// forcing every call site into open/onConfirm state of its own.
//
// The real safety comes from the `facts` list, not the extra click. A dialog
// that only says "Are you sure?" adds a click and no information; one that says
// "1,224 recipients · offer__independence_day · +91 95552 19007" is what
// actually stops the wrong send, because the wrong number is visible in it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Send, ShieldAlert, X } from "lucide-react";

export type ConfirmTone =
  | "danger"    // destroys or removes something
  | "caution"   // irreversible and outward-facing — a send, a push to a CRM
  | "neutral";  // significant but safe

export interface ConfirmOptions {
  title: string;
  /** One or two sentences on what happens, and what cannot be undone. */
  message?: React.ReactNode;
  /** The specifics being acted on. This is the part that prevents mistakes. */
  facts?: { label: string; value: string }[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /**
   * Require the exact string to be typed before the action unlocks. Reserve it
   * for the handful of actions whose blast radius is everyone — a broadcast, a
   * bulk delete. Used everywhere it stops being read.
   */
  typeToConfirm?: string;
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/**
 * Opens the shared confirmation dialog and resolves true when confirmed.
 *
 * Falls back to the native window.confirm outside a provider so a component
 * rendered in isolation (a test, a future route) still guards its action rather
 * than silently performing it.
 */
export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext);
  return useMemo<Ask>(
    () => ctx ?? (async (o) => (typeof window === "undefined" ? false : window.confirm(o.title))),
    [ctx],
  );
}

const TONES: Record<ConfirmTone, { icon: React.ReactNode; ring: string; btn: string; wash: string }> = {
  danger: {
    icon: <AlertTriangle className="w-[18px] h-[18px]" />,
    ring: "bg-red-50 text-red-600",
    btn: "bg-red-600 text-white hover:bg-red-700",
    wash: "border-red-200",
  },
  caution: {
    icon: <ShieldAlert className="w-[18px] h-[18px]" />,
    ring: "bg-amber-50 text-amber-600",
    btn: "bg-ink-900 text-white hover:bg-ink-950",
    wash: "border-amber-200",
  },
  neutral: {
    icon: <Send className="w-[18px] h-[18px]" />,
    ring: "bg-brand-50 text-brand-700",
    btn: "bg-brand-600 text-white hover:bg-brand-700",
    wash: "border-line",
  },
};

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  // Swallows a fast second click in the moment between confirming and the
  // dialog unmounting, so one gesture can never fire the action twice.
  const [working, setWorking] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Whatever had focus when the dialog opened, so Escape returns the user to
  // the button they were on rather than the top of the page.
  const restoreTo = useRef<HTMLElement | null>(null);

  const ask = useCallback<Ask>((opts) => {
    restoreTo.current = (document.activeElement as HTMLElement) ?? null;
    setTyped("");
    setWorking(false);
    return new Promise<boolean>(resolve => setPending({ ...opts, resolve }));
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending(p => { p?.resolve(ok); return null; });
    // Deferred: the dialog has to be gone before focus moves back, or the
    // browser scrolls the old trigger into view mid-unmount.
    requestAnimationFrame(() => restoreTo.current?.focus?.());
  }, []);

  const locked = !!pending?.typeToConfirm && typed.trim() !== pending.typeToConfirm;

  // Escape always cancels; Tab is trapped inside the panel so the underlying
  // page — which still holds the button that opened this — can't be reached and
  // clicked past the dialog.
  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); close(false); return; }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    // Scroll lock, restoring whatever was there rather than assuming "".
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [pending, close]);

  // Focus lands on Cancel, never on the action. A dialog that opens with the
  // destructive button focused turns the stray Enter keypress it exists to
  // prevent into a single extra keystroke.
  useEffect(() => {
    if (!pending) return;
    (pending.typeToConfirm ? inputRef.current : cancelRef.current)?.focus();
  }, [pending]);

  const tone = TONES[pending?.tone ?? "danger"];

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink-950/45 u-fade-in"
            onClick={() => close(false)}
          />
          <div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="relative w-full max-w-[420px] bg-white rounded-card shadow-float border border-line overflow-hidden u-scale-in"
          >
            <div className="p-5 pb-4 flex gap-3.5">
              <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${tone.ring}`}>
                {tone.icon}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <h2 id="confirm-title" className="text-[15px] font-bold text-ink-900 leading-snug">{pending.title}</h2>
                {pending.message && <div className="text-[13px] text-ink-600 leading-relaxed">{pending.message}</div>}
              </div>
              <button
                onClick={() => close(false)}
                aria-label="Cancel"
                className="shrink-0 self-start -mt-1 -mr-1 p-1 rounded-control text-ink-400 hover:text-ink-900 hover:bg-canvas"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* The facts of the action. Anything that would make the user stop
                — the number it leaves from, how many people it reaches — belongs
                here, where it is read, rather than in the sentence above. */}
            {pending.facts && pending.facts.length > 0 && (
              <dl className={`mx-5 mb-4 rounded-control border bg-canvas divide-y divide-line ${tone.wash}`}>
                {pending.facts.map(f => (
                  <div key={f.label} className="flex items-baseline gap-3 px-3 py-2">
                    <dt className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-400">{f.label}</dt>
                    <dd className="min-w-0 flex-1 text-right text-[12.5px] font-semibold text-ink-900 break-words">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {pending.typeToConfirm && (
              <div className="mx-5 mb-4 space-y-1.5">
                <label htmlFor="confirm-type" className="block text-[12px] text-ink-600">
                  Type <b className="font-mono font-bold text-ink-900">{pending.typeToConfirm}</b> to continue
                </label>
                <input
                  id="confirm-type"
                  ref={inputRef}
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !locked) { e.preventDefault(); close(true); } }}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-3 py-2 rounded-control border border-line font-mono text-[13px] text-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/15 focus:border-ink-400"
                />
              </div>
            )}

            <div className="px-5 py-3.5 bg-canvas border-t border-line flex items-center justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={() => close(false)}
                className="px-3.5 py-2 rounded-control border border-line bg-white text-[13px] font-bold text-ink-600 hover:bg-canvas"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                onClick={() => { setWorking(true); close(true); }}
                disabled={locked || working}
                className={`px-3.5 py-2 rounded-control text-[13px] font-bold disabled:opacity-40 disabled:cursor-not-allowed ${tone.btn}`}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
