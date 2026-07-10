import Link from "next/link";
import { Container, SectionTitle } from "./_components/ui";
import { FeatureGrid, ThreeSteps, StatsBand, IntegrationsStrip, Testimonials, CtaBand, ProblemSolution, ComparisonTable } from "./_components/sections";
import { WhyChoose } from "./_components/why-choose";
import { PricingTiers } from "./_components/pricing";
import { AgentCanvas } from "./_components/canvas";
import { FlowShowcase } from "./_components/flowshowcase";
import { PlatformGlimpse } from "./_components/glimpse";
import { Hero } from "./_components/hero";
import { IndustryStrip } from "./_components/industries";
import { Faq } from "./_components/chrome";

export default function HomePage() {
  return (
    <>
      {/* Hero — orbit panel */}
      <Hero />

      {/* Platform glimpse — leads the page with a look inside the product */}
      <PlatformGlimpse />

      {/* Signature n8n-style automation canvas */}
      <div id="how-it-works" className="scroll-mt-20"><AgentCanvas /></div>

      {/* Interactive: pick a business problem → see its flow */}
      <FlowShowcase />

      {/* Business problem → one-platform solution */}
      <ProblemSolution />

      {/* Industry playbooks teaser → /industries */}
      <IndustryStrip />

      <ThreeSteps />

      {/* Features */}
      <Container className="py-8">
        <SectionTitle eyebrow="Everything you need" title="One platform for every conversation" subtitle="One AI-native inbox for WhatsApp, Instagram, Messenger and your website." />
        <FeatureGrid />
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
        <div className="mt-8 flex flex-col items-center gap-2 text-center">
          <Link href="/pricing" className="text-sm font-bold text-[#0783fd] hover:underline">Compare all plans →</Link>
          <Link href="/pricing" className="text-xs font-semibold text-slate-500 hover:text-[#0783fd]">Creating on Instagram? See Creator plans from ₹999/mo →</Link>
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
