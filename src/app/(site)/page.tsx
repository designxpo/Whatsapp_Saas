import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Glow, Button, SectionTitle } from "./_components/ui";
import { FeatureGrid, ThreeSteps, WhyChoose, StatsBand, IntegrationsStrip, Testimonials, CtaBand, ProblemSolution, ComparisonTable } from "./_components/sections";
import { PricingTiers } from "./_components/pricing";
import { AgentCanvas } from "./_components/canvas";
import { FlowShowcase } from "./_components/flowshowcase";
import { PlatformGlimpse } from "./_components/glimpse";
import { Reveal } from "./_components/motion";
import { Faq } from "./_components/chrome";
import { HERO, SOCIAL_PROOF } from "./_content/site";

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <Glow className="left-[-80px] top-10" />
        <Glow className="right-[-80px] top-24" />
        <Container className="relative pt-16 pb-6 text-center">
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
            {HERO.title}
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-balance text-base text-slate-500 sm:text-lg">{HERO.subtitle}</p>

          <div className="mt-6 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#0783fd]/8 px-3 py-1.5 text-xs font-semibold text-[#0783fd] ring-1 ring-[#0783fd]/15">
              <span className="flex -space-x-2">
                {["A", "R", "S"].map(c => <span key={c} className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0783fd] text-[9px] font-bold text-white ring-2 ring-white">{c}</span>)}
              </span>
              {SOCIAL_PROOF}
            </span>
          </div>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={HERO.primary.href}>{HERO.primary.label} <ArrowRight className="h-4 w-4" /></Button>
            <Button href="#how-it-works" variant="ghost">See how it works</Button>
          </div>
          <p className="mt-4 text-xs font-medium text-slate-400">{HERO.note}</p>
        </Container>
      </section>

      {/* Platform glimpse — leads the page with a look inside the product */}
      <PlatformGlimpse />

      {/* Signature n8n-style automation canvas */}
      <div id="how-it-works" className="scroll-mt-20"><AgentCanvas /></div>

      {/* Interactive: pick a business problem → see its flow */}
      <FlowShowcase />

      {/* Business problem → one-platform solution */}
      <ProblemSolution />

      <ThreeSteps />

      {/* Features */}
      <Container className="py-8">
        <Reveal>
          <SectionTitle eyebrow="Everything you need" title="One platform for every conversation" subtitle="One AI-native inbox for WhatsApp and Instagram." />
        </Reveal>
        <Reveal delay={120}><FeatureGrid /></Reveal>
      </Container>

      <WhyChoose />

      {/* Talko AI vs the alternatives */}
      <ComparisonTable />

      <IntegrationsStrip />
      <StatsBand />

      {/* Pricing teaser */}
      <Container className="py-12">
        <SectionTitle eyebrow="Pricing" title="Simple, transparent pricing" subtitle="Free for 14 days. Cancel anytime." />
        <PricingTiers />
        <div className="mt-8 text-center">
          <Link href="/pricing" className="text-sm font-bold text-[#0783fd] hover:underline">Compare all plans →</Link>
        </div>
      </Container>

      <Testimonials />

      <Container className="py-12">
        <SectionTitle eyebrow="FAQ" title="Frequently asked questions" />
        <Faq />
      </Container>

      <CtaBand />
    </>
  );
}
