import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Rocket, Plug, Workflow, LifeBuoy } from "lucide-react";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { GUIDES, type Guide } from "../_content/guides";

export const metadata: Metadata = {
  title: "Setup Guides — Talko AI",
  description: "Step-by-step guides for connecting WhatsApp, Instagram, Messenger, YouTube, Google reviews and website chat to Talko AI — no developer needed.",
};

const CATEGORIES: { key: Guide["category"]; label: string; blurb: string; icon: typeof Rocket }[] = [
  { key: "Getting started", label: "Getting started", blurb: "Your first day with Talko AI, start to finish.", icon: Rocket },
  { key: "Connect a channel", label: "Connect a channel", blurb: "Bring each channel your customers use into one inbox.", icon: Plug },
  { key: "Automate", label: "Automate", blurb: "Set up the AI and flows that do the work for you.", icon: Workflow },
];

export default function GuidesPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Guides" title="Set up Talko AI yourself, step by step"
            subtitle="Plain-language guides for connecting every channel and turning on automation — no developer needed. Most take five to ten minutes." />
        </Container>
      </section>

      {CATEGORIES.map(cat => {
        const items = GUIDES.filter(g => g.category === cat.key);
        if (!items.length) return null;
        const Icon = cat.icon;
        return (
          <Container key={cat.key} className="py-8">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><Icon className="h-5 w-5" /></span>
              <div>
                <h2 id={cat.key.toLowerCase().replace(/\s+/g, "-")} className="scroll-mt-24 text-lg font-extrabold text-slate-900">{cat.label}</h2>
                <p className="text-sm text-slate-500">{cat.blurb}</p>
              </div>
            </div>
            <div className="mx-auto mt-6 grid max-w-5xl gap-5 md:grid-cols-2 lg:grid-cols-3">
              {items.map(g => (
                <Link key={g.slug} href={`/guides/${g.slug}`}
                  className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_12px_30px_-12px_rgba(7,131,253,0.3)]">
                  <h3 className="text-base font-bold leading-snug text-slate-900 group-hover:text-[#0783fd]">{g.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{g.summary}</p>
                  <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                    <span>{g.timeEstimate}</span>
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        );
      })}

      {/* Not part of the step-by-step Guide set (it's symptom/cause/fix, not a
          walkthrough) — surfaced as its own card rather than forced into a
          category above it doesn't belong in. */}
      <Container className="py-8">
        <Link href="/guides/troubleshooting"
          className="group mx-auto flex max-w-3xl items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_12px_30px_-12px_rgba(7,131,253,0.3)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><LifeBuoy className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 group-hover:text-[#0783fd]">Something not working? Troubleshooting</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">Symptom, cause and fix for the issues that come up most — WhatsApp, Instagram, YouTube, Reviews, AI replies and billing.</p>
          </div>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#0783fd]" />
        </Link>
      </Container>

      <CtaBand />
    </>
  );
}
