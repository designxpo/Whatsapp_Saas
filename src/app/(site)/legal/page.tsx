import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { LEGAL_DOCS, LEGAL_EFFECTIVE } from "../_content/legal";

export const metadata: Metadata = {
  title: "Legal & policies — Talko AI",
  description: "Talko AI's Terms of Service, Privacy Policy, Acceptable Use Policy, Refund & Cancellation Policy and Cookie Policy.",
};

export default function LegalIndexPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Legal" title="Policies & legal"
            subtitle="The agreements and policies that govern your use of Talko AI. We keep them in plain language and up to date." />
        </Container>
      </section>

      <Container className="py-12">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {LEGAL_DOCS.map(d => (
            <Link key={d.slug} href={`/legal/${d.slug}`}
              className="group rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(24,119,242,0.25)]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900">{d.title}</h2>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-[#0783fd]" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{d.summary}</p>
            </Link>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-4xl text-center text-xs text-slate-400">All policies last updated {LEGAL_EFFECTIVE}.</p>
      </Container>

      <CtaBand />
    </>
  );
}
