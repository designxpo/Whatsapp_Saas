import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Container, Glow, SectionTitle } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { JsonLd } from "../../_components/json-ld";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { TROUBLESHOOTING } from "../../_content/troubleshooting";

export const metadata: Metadata = {
  title: "Troubleshooting — Talko AI",
  description: "Symptom, cause and fix for the most common issues across WhatsApp, Instagram, Messenger, YouTube, Google Reviews, AI replies and billing.",
};

// FAQPage schema — every entry here genuinely IS a question with a direct
// answer, unlike a sequential how-to, so FAQPage (not HowTo) is the accurate
// type for this page.
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: TROUBLESHOOTING.flatMap(section => section.issues.map(issue => ({
    "@type": "Question",
    name: issue.q,
    text: issue.q,
    acceptedAnswer: { "@type": "Answer", text: `${issue.cause} ${issue.fix}` },
  }))),
};

export default function TroubleshootingPage() {
  return (
    <>
      <JsonLd data={faqSchema} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[
            { name: "Home", href: "/" },
            { name: "Guides", href: "/guides" },
            { name: "Troubleshooting", href: "/guides/troubleshooting" },
          ]} />
          <Link href="/guides" className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[#0783fd]"><ArrowLeft className="h-4 w-4" /> All guides</Link>
          <div className="mx-auto mt-6 max-w-2xl text-center">
            <SectionTitle level={1} title="Troubleshooting" subtitle="Symptom, cause and fix — organized by channel, so you can jump straight to the thing that's actually wrong." />
          </div>
        </Container>
      </section>

      <Container className="py-8">
        {/* Quick-jump nav — this page is long by design; let people skip straight to their channel. */}
        <nav aria-label="Jump to a section" className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2">
          {TROUBLESHOOTING.map(s => (
            <a key={s.key} href={`#${s.key}`} className="rounded-full border border-slate-200 px-3.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-[#0783fd]/40 hover:text-[#0783fd]">
              {s.title}
            </a>
          ))}
        </nav>

        <div className="mx-auto mt-12 max-w-3xl space-y-16">
          {TROUBLESHOOTING.map(section => (
            <div key={section.key} id={section.key} className="scroll-mt-24">
              <h2 className="text-xl font-extrabold text-slate-900">{section.title}</h2>
              <div className="mt-5 space-y-4">
                {section.issues.map(issue => (
                  <div key={issue.q} className="rounded-2xl border border-slate-200 bg-white p-6">
                    <h3 className="text-sm font-bold text-slate-900">{issue.q}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-slate-500"><span className="font-semibold text-slate-600">Why: </span>{issue.cause}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500"><span className="font-semibold text-slate-600">Fix: </span>{issue.fix}</p>
                    {issue.guideHref && (
                      <Link href={issue.guideHref} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#0783fd] hover:underline">
                        {issue.guideLabel} <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Container>

      <CtaBand />
    </>
  );
}
