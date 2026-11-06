"use client";

// A proper in-page dialog for asking one piece of text (a cancel reason, a new
// name), replacing the browser's prompt(). Usage:
//   const [ask, dialog] = usePromptDialog();
//   const reason = await ask({ title: "Cancel this booking?", label: "Reason (optional)" });
//   if (reason === null) return;   // they closed it
//   …render {dialog} once in the component.

import { useCallback, useRef, useState } from "react";
import { Modal } from "./overlay";

export interface PromptOptions {
  title: string;
  message?: React.ReactNode;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true the confirm button stays off until something is typed. */
  required?: boolean;
  multiline?: boolean;
  tone?: "neutral" | "danger";
}

type Ask = (o: PromptOptions) => Promise<string | null>;

export function usePromptDialog(): [Ask, React.ReactNode] {
  const [opts, setOpts] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback<Ask>(o => new Promise(resolve => {
    resolver.current?.(null);
    resolver.current = resolve;
    setValue(o.defaultValue ?? "");
    setOpts(o);
  }), []);

  const finish = (v: string | null) => { resolver.current?.(v); resolver.current = null; setOpts(null); };
  const blocked = !!opts?.required && !value.trim();
  const field = "w-full rounded-control border border-line px-3 py-2.5 text-sm text-ink-900 focus:border-brand-500";

  const dialog = (
    <Modal open={!!opts} onClose={() => finish(null)} title={opts?.title ?? ""} size="sm"
      footer={opts && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => finish(null)} className="min-h-10 px-4 rounded-control border border-line text-sm font-semibold text-ink-700 hover:bg-canvas">{opts.cancelLabel ?? "Cancel"}</button>
          <button type="submit" form="prompt-dialog-form" disabled={blocked}
            className={`min-h-10 px-4 rounded-control text-sm font-semibold text-white disabled:opacity-50 ${opts.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-brand-700 hover:bg-brand-800"}`}>{opts.confirmLabel ?? "Save"}</button>
        </div>
      )}>
      {opts && (
        <form id="prompt-dialog-form" onSubmit={e => { e.preventDefault(); if (!blocked) finish(value.trim()); }} className="space-y-2">
          {opts.message && <div className="text-sm text-ink-600">{opts.message}</div>}
          <label className="block text-sm font-semibold text-ink-800" htmlFor="prompt-dialog-input">{opts.label}</label>
          {opts.multiline
            ? <textarea id="prompt-dialog-input" autoFocus rows={3} value={value} placeholder={opts.placeholder} onChange={e => setValue(e.target.value)} className={field} />
            : <input id="prompt-dialog-input" autoFocus value={value} placeholder={opts.placeholder} onChange={e => setValue(e.target.value)} className={field} />}
        </form>
      )}
    </Modal>
  );
  return [ask, dialog];
}
