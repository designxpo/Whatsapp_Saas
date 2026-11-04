import Link from "next/link";
import { Container, SectionTitle, Button } from "./_components/ui";
import {
  FeatureGrid,
  ThreeSteps,
  StatsBand,
  IntegrationsStrip,
  ProblemSolution,
  ComparisonTable,
  Glossary,
} from "./_components/sections";
import { WhyChoose } from "./_components/why-choose";
import { PricingTiers, RenewalNote } from "./_components/pricing";
import { AgentCanvas } from "./_components/canvas";
import { FlowShowcase } from "./_components/flowshowcase";
import { PlatformGlimpse } from "./_components/glimpse";
import { Hero } from "./_components/hero";
import { IndustryStrip } from "./_components/industries";
import { Faq } from "./_components/chrome";
import { JsonLd } from "./_components/json-ld";
import { webPageSchema } from "./_content/schema";
import {
  PlatformCapabilities,
  GrowthSpotlight,
  CreatorStory,
  NextStepBand,
} from "./_components/growth-story";
import { FAQS } from "./_content/site";

// FAQPage schema — the single structured-data type most correlated with AI
// answer-engine citation, since it's already the Q&A an engine wants to quote.
// Built from the same FAQS the on-page FAQ renders, so they never drift.
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  description:
    "Frequently asked questions about Talko AI's WhatsApp, Instagram, Messenger, YouTube and Google Reviews automation platform.",
  mainEntity: FAQS.map((f) => ({
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
    description:
      "AI-powered customer conversation platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat.",
    published: "2026-06-01",
    updated: "2026-11-01",
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
    <div className="marketing-home">
      <JsonLd data={faqSchema} />
      <JsonLd data={homeWebPage} />
      <Hero />

      <details className="marketing-definition group">
        <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-[#026cd4] [&::-webkit-details-marker]:hidden">
          What is Talko AI?
          <svg
            className="h-3 w-3 transition-transform group-open:rotate-180"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 4.5 6 7.5 9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <p
          id="site-tldr"
          className="mt-3 text-center text-sm leading-relaxed text-slate-500"
        >
          <strong className="font-semibold text-slate-700">
            Talko AI is an AI-powered customer conversation platform
          </strong>{" "}
          for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google
          Business Profile reviews and website chat. It&apos;s built for small
          businesses, D2C brands and agencies that want one inbox to auto-reply,
          qualify leads and sell across every channel — on their own AI key.
        </p>
      </details>

      <PlatformCapabilities />
      <GrowthSpotlight />
      <CreatorStory />
      <div className="marketing-overview">
        <PlatformGlimpse />
      </div>

      <section
        className="marketing-container marketing-library"
        id="features"
        aria-labelledby="library-heading"
      >
        <div className="marketing-library-intro">
          <div>
            <p className="marketing-eyebrow mb-3">GO DEEPER WHEN YOU NEED TO</p>
            <h2 id="library-heading">One platform for every conversation</h2>
          </div>
          <Link href="/features">Explore all features ↗</Link>
        </div>
        <details className="marketing-details">
          <summary>Explore the tools behind the conversation</summary>
          <div>
            <p className="mb-8 text-sm text-slate-600">
              One AI-native inbox for WhatsApp, Instagram, Messenger, YouTube
              and your website — plus AI replies for your Google reviews.
            </p>
            <FeatureGrid />
          </div>
        </details>
        <details className="marketing-details">
          <summary>See how your automations connect</summary>
          <div>
            <AgentCanvas />
            <FlowShowcase />
          </div>
        </details>
        <details className="marketing-details">
          <summary>Find the right playbook for your business</summary>
          <div>
            <IndustryStrip />
            <ThreeSteps />
          </div>
        </details>
        <details className="marketing-details">
          <summary>Compare Talko AI and explore the details</summary>
          <div>
            <ProblemSolution />
            <WhyChoose />
            <ComparisonTable />
            <Glossary />
            <IntegrationsStrip />
            <StatsBand />
          </div>
        </details>
      </section>

      <section
        className="marketing-container marketing-plan-intro"
        id="pricing"
        aria-labelledby="plans-heading"
      >
        <div className="marketing-plan-heading">
          <div>
            <p className="marketing-eyebrow">SIMPLE, TRANSPARENT PRICING</p>
            <h2 id="plans-heading">Your ambition. Your plan.</h2>
            <p>
              Free for 14 days. Cancel anytime.
              <br />
              Creator plans from ₹999/mo.
            </p>
          </div>
          <div className="marketing-plan-actions">
            <Button href="/pricing">Compare all plans →</Button>
            <Link href="/pricing" className="text-xs">
              Creating on Instagram? See Creator plans →
            </Link>
          </div>
        </div>
        <details className="marketing-details">
          <summary>View plans and everything that’s included</summary>
          <div>
            <PricingTiers />
            <RenewalNote className="mt-8" />
          </div>
        </details>
      </section>

      <Container className="marketing-faq">
        <SectionTitle
          id="faq"
          eyebrow="FAQ"
          title="Frequently asked questions"
        />
        <Faq />
      </Container>
      <NextStepBand />
    </div>
  );
}
