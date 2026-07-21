import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { FeatureGrid, ThreeSteps, IntegrationsGrid, StatsBand, CtaBand, ProblemSolution, ComparisonTable } from "../_components/sections";
import { AgentCanvas } from "../_components/canvas";
import { FlowShowcase } from "../_components/flowshowcase";

export const metadata: Metadata = {
  title: "WhatsApp & Instagram Automation Features — Talko AI",
  description: "AI replies, broadcasts, chatbot flows, drip sequences, catalog checkout, Instagram & Messenger automation, a website web-chat widget and a unified inbox — everything in one platform.",
  openGraph: {
    title: "WhatsApp & Instagram Automation Features — Talko AI",
    description: "AI replies, broadcasts, chatbot flows, catalog checkout and a unified inbox for WhatsApp, Instagram, Messenger and web chat — one platform.",
  },
};

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Features" title="Powerful features for modern messaging"
            subtitle="From the first hello to repeat purchases — Talko AI automates the whole conversation across WhatsApp, Instagram, Messenger and your website." />
        </Container>
      </section>

      <Container className="pb-8">
        <FeatureGrid />
      </Container>

      <AgentCanvas />
      <FlowShowcase />
      <ProblemSolution />
      <ComparisonTable />
      <ThreeSteps />
      <IntegrationsGrid />
      <StatsBand />
      <CtaBand />
    </>
  );
}
