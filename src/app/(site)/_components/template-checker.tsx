"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { checkTemplate } from "@/lib/whatsapp-template-rules";

// The interactive template checker embedded in the rejection post. The rules
// themselves live in lib/whatsapp-template-rules.ts — pure and unit-tested;
// this file is only the view around them.
//
// It runs entirely in the browser: nothing is uploaded, which matters because
// people paste real customer-facing copy in here.

const SAMPLE = {
  header: "Order update",
  body: "{{1}}, your order {{2}}{{3}} is out for delivery and should reach you today.",
  footer: "Reply STOP to opt out {{4}}",
};

export function TemplateChecker() {
  const [header, setHeader] = useState(SAMPLE.header);
  const [body, setBody] = useState(SAMPLE.body);
  const [footer, setFooter] = useState(SAMPLE.footer);

  const findings = useMemo(() => checkTemplate({ header, body, footer }), [header, body, footer]);
  const failures = findings.filter(f => !f.ok);

  const field = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0783fd] focus:ring-2 focus:ring-[#0783fd]/20";

  return (
    <div className="not-prose my-10 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <h3 className="text-base font-bold text-slate-900">Check your template before you submit it</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Paste the template you&rsquo;re about to send to Meta. Every rule checked here is one that rejects a
          template outright. It runs in your browser — nothing is uploaded.
        </p>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label htmlFor="tc-header" className="text-xs font-bold text-slate-600">Header <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="tc-header" className={`${field} mt-1`} value={header} onChange={e => setHeader(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tc-body" className="text-xs font-bold text-slate-600">Body</label>
            <textarea id="tc-body" rows={5} className={`${field} mt-1 resize-y font-mono text-[13px]`} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tc-footer" className="text-xs font-bold text-slate-600">Footer <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="tc-footer" className={`${field} mt-1`} value={footer} onChange={e => setFooter(e.target.value)} />
          </div>

          {/* Live preview — what the customer actually sees, in a WhatsApp bubble. */}
          <div className="rounded-xl bg-[#e4ddd4] p-3">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Preview</p>
            <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
              {header && <p className="text-[13px] font-bold text-slate-900">{header}</p>}
              <p className="whitespace-pre-wrap text-[13px] leading-snug text-slate-800">{body || "…"}</p>
              {footer && <p className="mt-1.5 text-[11px] text-slate-500">{footer}</p>}
            </div>
          </div>
        </div>

        <div>
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border px-4 py-3 ${failures.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}
          >
            <p className={`flex items-center gap-2 text-sm font-bold ${failures.length ? "text-amber-900" : "text-emerald-900"}`}>
              {failures.length
                ? <><AlertTriangle className="h-4 w-4" /> {failures.length} thing{failures.length > 1 ? "s" : ""} would get this rejected</>
                : <><Check className="h-4 w-4" /> Nothing here breaks a documented rule</>}
            </p>
            {!failures.length && (
              <p className="mt-1 text-xs leading-relaxed text-emerald-800">
                Structure is fine. Approval still depends on the content itself and on picking the right
                category — those are judgement calls no checker can make for you.
              </p>
            )}
          </div>

          <ul className="mt-3 space-y-2">
            {findings.map((f, i) => (
              <li key={i} className={`flex gap-2.5 rounded-xl border px-3 py-2.5 ${f.ok ? "border-slate-200 bg-white" : "border-amber-200 bg-white"}`}>
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${f.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {f.ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                </span>
                <span>
                  <span className={`block text-[13px] font-bold ${f.ok ? "text-slate-700" : "text-slate-900"}`}>{f.title}</span>
                  <span className="block text-xs leading-relaxed text-slate-500">{f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
