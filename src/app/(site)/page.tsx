import Link from "next/link";
import { Container, SectionTitle } from "./_components/ui";
import { FeatureGrid, ThreeSteps, StatsBand, IntegrationsStrip, Testimonials, CtaBand, ProblemSolution, ComparisonTable, Glossary } from "./_components/sections";
import { WhyChoose } from "./_components/why-choose";
import { PricingTiers } from "./_components/pricing";
import { AgentCanvas } from "./_components/canvas";
import { FlowShowcase } from "./_components/flowshowcase";
import { PlatformGlimpse } from "./_components/glimpse";
import { Hero } from "./_components/hero";
import { IndustryStrip } from "./_components/industries";
import { Faq } from "./_components/chrome";
import { JsonLd } from "./_components/json-ld";
import { webPageSchema } from "./_content/schema";
import { FAQS } from "./_content/site";

// FAQPage schema — the single structured-data type most correlated with AI
// answer-engine citation, since it's already the Q&A an engine wants to quote.
// Built from the same FAQS the on-page FAQ renders, so they never drift.
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  description: "Frequently asked questions about Talko AI's WhatsApp, Instagram, Messenger, YouTube and Google Reviews automation platform.",
  mainEntity: FAQS.map(f => ({
    "@type": "Question",
    name: f.q,
    text: f.q,
    dateCreated: "2026-06-01",
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

// WebPage wrapper carrying the freshness signal (GEO/AEO checkers look for a
// published/updated date; a homepage has no visible byline for this, so it
// lives in structured data instead). Bump `updated` when the homepage copy
// changes materially — it's a manual signal, not a build timestamp.
//
// Built from the shared builder so the homepage joins the same entity graph as
// every other page, then extended with `speakable`: the headline and the
// plain-language summary are the two elements that alone answer "what is this",
// which is exactly what a voice or LLM excerpt should quote. No breadcrumb —
// the homepage IS the root, so there's no trail to point at.
const homeWebPage = {
  ...webPageSchema({
    path: "",
    name: "Talko AI — WhatsApp, Instagram & YouTube Chat Automation with AI",
    description: "AI-powered customer conversation platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat.",
    published: "2026-06-01",
    updated: "2026-08-05",
    breadcrumb: false,
  }),
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: ["#hero-heading", "#site-tldr"],
  },
};

// NOTE: the SoftwareApplication that used to be declared here now lives in
// _content/schema.ts and ships from the (site) layout on every page, with a
// stable `@id` and the full priced offer table. Declaring a second, near-
// identical copy here made the homepage assert two competing product entities.

export default function HomePage() {
  return (
    <>
      <JsonLd data={faqSchema} />
      <JsonLd data={homeWebPage} />
      {/* Hero — orbit panel */}
      <Hero />

      {/* Plain-language definition near the top of the page — answers "what is
          Talko AI" directly for readers and answer engines, instead of making
          them infer it from the hero's benefit-led copy. Ordinary flowing
          copy, no boxed-off callout and no label: the sentence itself is the
          answer, which is what answer-engine extraction actually rewards —
          not the presence of a "summary" wrapper around it. */}
      <p id="site-tldr" className="mx-auto max-w-2xl px-5 pb-6 text-center text-sm leading-relaxed text-slate-500">
        Talko AI is an AI-powered customer conversation platform for WhatsApp, Instagram, Facebook Messenger, YouTube
        comments, Google Business Profile reviews and website chat. It&apos;s built for small businesses, D2C brands and
        agencies that want one inbox to auto-reply, qualify leads and sell across every channel — on their own AI key.
      </p>

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
        <SectionTitle id="features" eyebrow="Everything you need" title="One platform for every conversation" subtitle="One AI-native inbox for WhatsApp, Instagram, Messenger, YouTube and your website — plus AI replies for your Google reviews." />
        <FeatureGrid />
      </Container>

      <WhyChoose />

      {/* Talko AI vs the alternatives */}
      <ComparisonTable />

      {/* Core concepts, defined plainly — extractable as direct answers */}
      <Glossary />

      <IntegrationsStrip />
      <StatsBand />

      {/* Pricing teaser */}
      <Container className="py-12">
        <SectionTitle id="pricing" eyebrow="Pricing" title="Simple, transparent pricing" subtitle="Free for 14 days. Cancel anytime." />
        <PricingTiers />
        <div className="mt-8 flex flex-col items-center gap-2 text-center">
          <Link href="/pricing" className="text-sm font-bold text-[#0783fd] hover:underline">Compare all plans →</Link>
          <Link href="/pricing" className="text-xs font-semibold text-slate-500 hover:text-[#0783fd]">Creating on Instagram? See Creator plans from ₹999/mo →</Link>
        </div>
      </Container>

      <Testimonials />

      <Container className="py-12">
        <SectionTitle id="faq" eyebrow="FAQ" title="Frequently asked questions" />
        <Faq />
      </Container>

      <CtaBand />
    </>
  );
}
