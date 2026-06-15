"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "./ui";
import { TIERS } from "../_content/site";

const ANNUAL_DISCOUNT = 0.2; // 20% off when billed annually

function inr(n: number) { return `₹${n.toLocaleString("en-IN")}`; }

export function PricingTiers() {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span className={`text-sm font-semibold ${!annual ? "text-slate-900" : "text-slate-400"}`}>Monthly</span>
        <button
          onClick={() => setAnnual(a => !a)}
          className={`relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full px-1 transition-colors ${annual ? "bg-[#0783fd]" : "bg-slate-300"}`}
          role="switch"
          aria-checked={annual}
          aria-label="Toggle annual billing"
        >
          <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${annual ? "translate-x-[24px]" : "translate-x-0"}`} />
        </button>
        <span className={`inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold ${annual ? "text-slate-900" : "text-slate-400"}`}>
          Annually <span className="rounded-full bg-[#DDEFE4] px-2 py-0.5 text-[11px] font-bold text-[#2f9e6e]">Save 20%</span>
        </span>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {TIERS.map(t => {
          const monthlyEq = t.priceMonthly == null ? null : Math.round(t.priceMonthly * (annual ? 1 - ANNUAL_DISCOUNT : 1));
          return (
            <div
              key={t.name}
              className={`relative rounded-2xl border p-7 transition-shadow ${t.highlighted ? "border-[#0783fd] bg-white shadow-[0_20px_50px_-20px_rgba(24,119,242,0.5)]" : "border-slate-200 bg-white hover:shadow-[0_12px_30px_-16px_rgba(24,119,242,0.4)]"}`}
            >
              {t.highlighted && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#0783fd] px-3 py-1 text-[11px] font-bold text-white">Most popular</span>}
              <h3 className="text-sm font-extrabold text-slate-900">{t.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{t.tagline}</p>
              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-slate-900">{monthlyEq == null ? t.customLabel : inr(monthlyEq)}</span>
                {monthlyEq != null && <span className="pb-1 text-sm text-slate-500">/mo</span>}
              </div>
              <p className="mt-1 h-4 text-[11px] text-[#0783fd]">{annual && monthlyEq != null ? `Billed annually · ${inr(monthlyEq * 12)}/yr` : " "}</p>
              <Button href={t.href} variant={t.highlighted ? "primary" : "ghost"} className="mt-5 w-full">{t.cta}</Button>
              <ul className="mt-7 space-y-3">
                {t.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0783fd]" />{f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
