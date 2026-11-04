import Link from "next/link";
import { Check } from "lucide-react";
import { Button, GRADIENTS } from "./ui";
import { Reveal } from "./motion";
import { TIERS, type Tier } from "../_content/site";
import { allInclusiveRupees } from "@/lib/billing-tax";

function inr(n: number) { return `₹${n.toLocaleString("en-IN")}`; }

// Monthly prices only. There is no annual toggle: in-app checkout sells
// monthly Razorpay plans only, so an annual price here couldn't be bought.
export function PricingTiers({ tiers = TIERS }: { tiers?: Tier[] }) {
  const cols = tiers.length >= 3 ? "lg:grid-cols-3" : "sm:grid-cols-2 lg:max-w-3xl lg:mx-auto";

  return (
    <>
      <div className={`mt-10 grid gap-6 ${cols}`}>
        {tiers.map((t, ti) => {
          // Quote what is actually charged, not a base price with conditions
          // attached. There is no tax or fee added at checkout (see
          // src/lib/billing-tax.ts — the company is not GST-registered, so a
          // "+ GST" qualifier here would be advertising a tax we may not
          // collect), which means the advertised figure has to be the final one.
          const price = t.priceMonthly == null ? null : allInclusiveRupees(t.priceMonthly);
          return (
            <Reveal key={t.name} delay={ti * 100} className="h-full">
            <div
              className={`site-plan-card relative h-full rounded-2xl border p-7 transition-shadow ${t.highlighted ? "border-[#0783fd] bg-white shadow-[0_22px_55px_-20px_rgba(106,92,255,0.5)]" : "border-slate-200 bg-white hover:shadow-[0_12px_30px_-16px_rgba(7,131,253,0.4)]"}`}
            >
              {t.highlighted && <span className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${GRADIENTS.brand} px-3 py-1 text-[11px] font-bold text-white ring-4 ring-white`}>Most popular</span>}
              <h3 className="text-sm font-extrabold text-slate-900">{t.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{t.tagline}</p>
              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-slate-900">{price == null ? t.customLabel : inr(price)}</span>
                {price != null && <span className="pb-1 text-sm text-slate-500">/mo</span>}
              </div>
              <p className="mt-1 h-4 text-[11px] text-slate-500">{price != null ? "Billed monthly" : null}</p>
              <Button href={t.href} variant={t.highlighted ? "primary" : "ghost"} className="mt-5 w-full">{t.cta}</Button>
              <ul className="mt-7 space-y-3">
                {t.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#026cd4]" />{f}
                  </li>
                ))}
              </ul>
            </div>
            </Reveal>
          );
        })}
      </div>
    </>
  );
}

// Auto-renewal disclosure, shown under every set of plan cards. Worded to match
// the Refund & Cancellation Policy (_content/legal.ts): renews at the start of
// each billing period until cancelled, access runs to the end of the paid
// period, payments already made aren't refunded. The trial line holds because
// signup never collects a card, so there is nothing to charge when it ends.
export function RenewalNote({ className = "" }: { className?: string }) {
  return (
    <p className={`mx-auto max-w-2xl text-center text-xs leading-relaxed text-slate-600 ${className}`}>
      Paid plans are billed monthly and renew automatically at the start of each month until you cancel.
      Cancel anytime from the billing area of your account; you keep access until the end of the period you&apos;ve paid for, and
      payments already made aren&apos;t refunded except where the law requires. The 14-day free trial needs no card, so nothing is
      charged when it ends.{" "}
      <Link href="/legal/refund" className="font-semibold text-[#026cd4] underline hover:no-underline">Refund &amp; cancellation policy</Link>
    </p>
  );
}
