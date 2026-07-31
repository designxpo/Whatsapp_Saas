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
import { FAQS, TIERS } from "./_content/site";
import { SITE_URL } from "@/lib/siteurl";

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
// lives in structured data instead). Bump dateModified when the homepage copy
// changes materially — it's a manual signal, not a build timestamp.
const webPageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${SITE_URL}/#webpage`,
  url: SITE_URL,
  name: "Talko AI — WhatsApp, Instagram & YouTube Chat Automation with AI",
  isPartOf: { "@id": `${SITE_URL}/#website` },
  about: { "@id": `${SITE_URL}/#organization` },
  datePublished: "2026-06-01",
  dateModified: "2026-07-31",
  // Marks the headline and the plain-language summary as the voice/LLM-ready
  // excerpt of the page — the two elements that alone answer "what is this".
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: ["#hero-heading", "#site-tldr"],
  },
};

// SoftwareApplication — disambiguates "Talko AI the product" from "Talko AI /
// PM Technologies the organization" (both already covered by Organization
// schema in layout.tsx), which is what search/AI engines use `sameAs`-style
// typing for when no external profile URLs exist yet to link out to.
const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Talko AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: "AI-powered customer conversation platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat.",
  offers: {
    "@type": "Offer",
    price: String(TIERS[0].priceMonthly),
    priceCurrency: "INR",
    url: `${SITE_URL}/pricing`,
  },
  publisher: { "@id": `${SITE_URL}/#organization` },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={faqSchema} />
      <JsonLd data={webPageSchema} />
      <JsonLd data={softwareAppSchema} />
      {/* Hero — orbit panel */}
      <Hero />

      {/* Plain-language definition + key takeaway near the top of the page —
          answers "what is Talko AI" directly for readers and answer engines,
          instead of making them infer it from the hero's benefit-led copy. */}
      <p id="site-tldr" className="mx-auto max-w-2xl px-5 pb-6 text-center text-sm leading-relaxed text-slate-500">
        <strong className="font-bold text-slate-700">In short:</strong> Talko AI is an AI-powered customer conversation
        platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and
        website chat. It&apos;s built for small businesses, D2C brands and agencies that want one inbox to auto-reply,
        qualify leads and sell across every channel — on their own AI key.
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
