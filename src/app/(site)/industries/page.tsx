import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand, StatsBand } from "../_components/sections";
import { IndustrySections } from "../_components/industries";

export const metadata: Metadata = {
  title: "WhatsApp Automation by Industry — Talko AI",
  description:
    "How D2C brands, EdTech, clinics, real estate agencies, restaurants and travel companies run on Talko AI — chat commerce, patient triage, lead qualification, chat ordering and grounded AI answers on WhatsApp, Instagram, Messenger and web chat.",
  openGraph: {
    title: "WhatsApp Automation by Industry — Talko AI",
    description: "Playbooks for D2C, EdTech, clinics, real estate, restaurants and travel — WhatsApp, Instagram, Messenger & web-chat automation tailored to your vertical.",
  },
};

export default function IndustriesPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-10">
          <SectionTitle
            level={1}
            eyebrow="Industries"
            title="How businesses like yours run on Talko AI"
            subtitle="Six playbooks, one platform. The same building blocks — AI replies, chatbot flows, broadcasts, drips and payments — arranged for the way your industry actually sells and supports."
          />
        </Container>
      </section>

      <IndustrySections />

      <StatsBand />
      <CtaBand />
    </>
  );
}
