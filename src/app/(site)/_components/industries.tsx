"use client";

// Industry playbooks — how six different verticals run on Talko AI.
// Each section pairs a use-case story + proven-feature list with a phone-style
// chat mock showing that industry's signature moment. IndustryStrip is the
// compact homepage teaser grid linking into /industries#<slug>.

import Link from "next/link";
import {
  ShoppingBag, BookOpen, ShieldCheck, Building2, UtensilsCrossed, Plane,
  ArrowRight, Check, type LucideIcon,
} from "lucide-react";
import { Container, SectionTitle, ICON_GRADIENTS, GRADIENTS } from "./ui";
import { Reveal } from "./motion";
import { INDUSTRIES, type Industry, type ChatBubble } from "../_content/industries";

const ICONS: Record<string, LucideIcon> = {
  shopping: ShoppingBag, book: BookOpen, shield: ShieldCheck,
  building: Building2, utensils: UtensilsCrossed, plane: Plane,
};
function Ico({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const I = ICONS[name] ?? ShoppingBag;
  return <I className={className} />;
}

// ── Phone-style chat mock ─────────────────────────────────────────────────────
function Bubble({ b }: { b: ChatBubble }) {
  if (b.from === "system") {
    return (
      <div className="my-1 self-center rounded-full bg-slate-200/80 px-3 py-1 text-center text-[10.5px] font-semibold text-slate-600">
        {b.text}
      </div>
    );
  }
  const isCustomer = b.from === "customer";
  return (
    <div className={`flex flex-col ${isCustomer ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug shadow-sm ${
          isCustomer
            ? `${GRADIENTS.brand} rounded-br-md text-white`
            : "rounded-bl-md border border-slate-200/70 bg-white text-slate-800"
        }`}
      >
        {b.text}
      </div>
      {b.chips && (
        <div className="mt-1.5 flex max-w-[86%] flex-wrap gap-1.5">
          {b.chips.map(c => (
            <span key={c} className="rounded-full border border-[#0783fd]/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0783fd]">
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PhoneChat({ ind }: { ind: Industry }) {
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_24px_60px_-24px_rgba(24,119,242,0.35)]">
      {/* Header */}
      <div className={`${GRADIENTS.brand} flex items-center gap-2.5 px-4 py-3 text-white`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <Ico name={ind.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold leading-tight">{ind.business}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] opacity-90">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> online · replies instantly
          </div>
        </div>
      </div>
      {/* Thread */}
      <div className="flex flex-col gap-2 bg-[#f2f6fb] px-3.5 py-4">
        {ind.chat.map((b, i) => <Bubble key={i} b={b} />)}
      </div>
    </div>
  );
}

// ── Full playbook sections (the /industries page body) ───────────────────────
export function IndustrySections() {
  return (
    <>
      {INDUSTRIES.map((ind, i) => {
        const flip = i % 2 === 1;
        return (
          <section key={ind.slug} id={ind.slug} className={`scroll-mt-24 ${i % 2 === 1 ? "bg-[#f6f9fd]" : ""}`}>
            <Container className="py-14 sm:py-16">
              <div className={`grid items-center gap-10 lg:grid-cols-2 ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
                <Reveal>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-white ${ICON_GRADIENTS[i % ICON_GRADIENTS.length]}`}>
                      <Ico name={ind.icon} />
                    </span>
                    <span className="text-sm font-bold uppercase tracking-wide text-[#0783fd]">{ind.name}</span>
                  </div>
                  <h2 className="mt-4 text-balance text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                    {ind.headline}
                  </h2>
                  <p className="mt-3 text-slate-600">{ind.story}</p>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {ind.features.map(f => (
                      <li key={f.title} className="rounded-xl border border-slate-200/80 bg-white p-3.5">
                        <div className="flex items-center gap-2 text-[13px] font-bold text-slate-900">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                            <Check className="h-3 w-3" />
                          </span>
                          {f.title}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{f.body}</p>
                      </li>
                    ))}
                  </ul>
                </Reveal>
                <Reveal delay={120}>
                  <PhoneChat ind={ind} />
                </Reveal>
              </div>
            </Container>
          </section>
        );
      })}
    </>
  );
}

// ── Homepage teaser grid ──────────────────────────────────────────────────────
export function IndustryStrip() {
  return (
    <Container className="py-12">
      <SectionTitle
        eyebrow="Built for your industry"
        title="One platform, six proven playbooks"
        subtitle="E-commerce checkout, patient triage, lead qualification, chat ordering — see exactly how businesses like yours run on Talko AI."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INDUSTRIES.map((ind, i) => (
          <Reveal key={ind.slug} delay={i * 60}>
            <Link
              href={`/industries#${ind.slug}`}
              className="group flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(24,119,242,0.3)]"
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-white ${ICON_GRADIENTS[i % ICON_GRADIENTS.length]}`}>
                <Ico name={ind.icon} className="h-5 w-5" />
              </span>
              <div className="mt-3 text-[15px] font-bold text-slate-900">{ind.navLabel}</div>
              <p className="mt-1 flex-1 text-[13px] leading-snug text-slate-500">{ind.teaser}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-[#0783fd]">
                See the playbook <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </Container>
  );
}
