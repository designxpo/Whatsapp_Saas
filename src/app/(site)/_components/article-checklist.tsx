"use client";

import { useId, useState } from "react";
import { CheckCheck, Copy, RotateCcw } from "lucide-react";

/** An article worksheet, deliberately separate from any portal configuration. */
export function ArticleChecklist({ title, items }: { title: string; items: string[] }) {
  const id = useId();
  const [checked, setChecked] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${title}\n${items.map((item, i) => `${checked.includes(i) ? "[x]" : "[ ]"} ${item}`).join("\n")}`);
      setMessage("Checklist copied. Share it with the person who owns this workflow.");
    } catch { setMessage("Copy is unavailable in this browser. You can select the checklist text instead."); }
  }
  return <section aria-labelledby={`${id}-title`} className="not-prose rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-violet-50 p-5 sm:p-6">
    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#026cd4]"><CheckCheck size={16} aria-hidden /> Your working checklist</p>
    <h3 id={`${id}-title`} className="mt-3 text-lg font-bold text-slate-900">{title}</h3>
    <p className="mt-2 text-sm text-slate-600">Tick the steps you have checked. This worksheet stays on this page and does not change your account.</p>
    <fieldset className="mt-5 space-y-3">
      <legend className="sr-only">{title}</legend>
      {items.map((item, i) => <label key={item} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700">
        <input type="checkbox" checked={checked.includes(i)} onChange={event => {
          setChecked(current => event.target.checked ? [...current, i] : current.filter(value => value !== i));
          setMessage("");
        }} className="mt-1 h-4 w-4 shrink-0 accent-[#0783fd]" />
        <span>{item}</span>
      </label>)}
    </fieldset>
    <p role="status" aria-live="polite" className="mt-4 text-sm font-semibold text-slate-700">{checked.length} of {items.length} steps checked</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#026cd4] px-4 py-2 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"><Copy size={15} aria-hidden /> Copy checklist</button>
      <button type="button" onClick={() => { setChecked([]); setMessage(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"><RotateCcw size={15} aria-hidden /> Reset</button>
    </div>
    <p role="status" className="mt-2 text-xs leading-relaxed text-slate-600">{message}</p>
    <p className="mt-3 text-xs leading-relaxed text-slate-500">Completing this list is a planning aid, not a certification or proof of performance.</p>
  </section>;
}
