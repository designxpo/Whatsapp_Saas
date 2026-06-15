import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { FeatureGrid, ThreeSteps, IntegrationsStrip, StatsBand, CtaBand } from "../_components/sections";
import { ChatFlowDiagram, SequenceFlowDiagram } from "../_components/flows";

export const metadata: Metadata = {
  title: "Features — Talko AI",
  description: "AI replies, broadcasts, chatbot flows, drip sequences, catalog checkout, Instagram automation and a unified inbox — everything in one platform.",
};

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle eyebrow="Features" title="Powerful features for modern messaging"
            subtitle="From the first hello to repeat purchases — Talko AI automates the whole conversation across WhatsApp and Instagram." />
        </Container>
      </section>

      <Container className="pb-8">
        <FeatureGrid />
      </Container>

      <ChatFlowDiagram />
      <SequenceFlowDiagram />
      <ThreeSteps />
      <IntegrationsStrip />
      <StatsBand />
      <CtaBand />
    </>
  );
}
