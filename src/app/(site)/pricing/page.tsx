import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { Testimonials, CtaBand } from "../_components/sections";
import { PricingTiers } from "../_components/pricing";
import { Faq } from "../_components/chrome";

export const metadata: Metadata = {
  title: "Pricing — Talko AI",
  description: "Simple, transparent pricing. Start free for 14 days. Bring your own AI key for predictable costs. Cancel anytime.",
};

export default function PricingPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle eyebrow="Pricing" title="Simple and transparent pricing"
            subtitle="Every plan includes a 14-day free trial. AI replies run on your own provider key, so usage costs stay yours and predictable." />
        </Container>
      </section>

      <Container className="pb-8">
        <PricingTiers />
        <p className="mt-8 text-center text-xs text-slate-500">Prices in INR, billed monthly. Need annual billing or a custom volume? <span className="font-semibold text-[#0164ff]">Talk to sales.</span></p>
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
