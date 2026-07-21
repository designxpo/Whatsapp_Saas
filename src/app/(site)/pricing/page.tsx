import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { Testimonials, CtaBand } from "../_components/sections";
import { PricingTiers } from "../_components/pricing";
import { Faq } from "../_components/chrome";
import { JsonLd } from "../_components/json-ld";
import { TIERS, CREATOR_TIERS, type Tier } from "../_content/site";
import { SITE_URL } from "@/lib/siteurl";

export const metadata: Metadata = {
  // NOTE: the root title template does NOT reach page.tsx segments under
  // (site)/ (only the (site) layout's own title) — so bake the brand in here.
  title: "WhatsApp Automation Pricing — Plans from ₹999/mo — Talko AI",
  description: "Simple, transparent WhatsApp & Instagram automation pricing from ₹999/mo. Start free for 14 days. Bring your own AI key for predictable costs. Cancel anytime.",
  // No `openGraph` object: Next overwrites (never merges) it per segment, so
  // setting one would wipe the shared og:image from (site)/opengraph-image.tsx.
  // Omitting it lets og:title/og:description auto-infer from the fields above.
};

// SoftwareApplication + priced Offers so AI engines can answer "how much does
// Talko AI cost" with a real table, and Google can show pricing rich results.
// Paid tiers only (Scale is custom/quote → no fixed price to publish).
const paidOffers = [...TIERS, ...CREATOR_TIERS]
  .filter((t): t is Tier & { priceMonthly: number } => typeof t.priceMonthly === "number")
  .map(t => ({
    "@type": "Offer",
    name: `${t.name} plan`,
    price: t.priceMonthly,
    priceCurrency: "INR",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: t.priceMonthly,
      priceCurrency: "INR",
      unitText: "MONTH",
    },
    url: `${SITE_URL}/pricing`,
  }));

const pricingSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Talko AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description:
    "AI conversation automation for WhatsApp, Instagram, Facebook Messenger and website chat — one inbox with AI replies, broadcasts, chatbot flows and catalog checkout.",
  offers: { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: 999, highPrice: 4999, offerCount: paidOffers.length, offers: paidOffers },
};

export default function PricingPage() {
  return (
    <>
      <JsonLd data={pricingSchema} />
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Pricing" title="Simple and transparent pricing"
            subtitle="Every plan includes a 14-day free trial. AI replies run on your own provider key, so usage costs stay yours and predictable." />
        </Container>
      </section>

      <Container className="pb-8">
        <PricingTiers />
        <p className="mt-8 text-center text-xs text-slate-500">Prices in INR, billed monthly. Need annual billing or a custom volume? <span className="font-semibold text-[#0783fd]">Talk to sales.</span></p>
      </Container>

      {/* Instagram-first plans for creators & influencers */}
      <Container className="py-12">
        <div className="rounded-[28px] bg-slate-50 px-5 py-12 sm:px-10">
          <SectionTitle eyebrow="For creators & influencers"
            title="Instagram-first plans for creators"
            subtitle="No WhatsApp business stack to pay for — just the Instagram DM & comment automation creators actually need. Reply to every DM, turn comments into DMs, and capture leads on autopilot." />
          <PricingTiers tiers={CREATOR_TIERS} showToggle={false} />
          <p className="mt-8 text-center text-xs text-slate-500">Need WhatsApp too? See the business plans above — or <span className="font-semibold text-[#0783fd]">talk to sales</span> for a custom mix.</p>
        </div>
      </Container>

      <Testimonials />

      <Container className="py-16">
        <SectionTitle eyebrow="FAQ" title="Frequently asked questions" />
        <Faq />
      </Container>

      <CtaBand />
    </>
  );
}
