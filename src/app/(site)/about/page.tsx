import type { Metadata } from "next";
import { Container, Glow, SectionTitle, Card, Eyebrow } from "../_components/ui";
import { StatsBand, CtaBand } from "../_components/sections";
import { ABOUT } from "../_content/site";

export const metadata: Metadata = {
  title: "About — Talko AI",
  description: "Talko AI helps businesses turn WhatsApp, Instagram, Messenger and website conversations into growth — compliantly, transparently, and at scale.",
};

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-8 text-center">
          <div className="flex justify-center"><Eyebrow>{ABOUT.eyebrow}</Eyebrow></div>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">{ABOUT.title}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-slate-500">{ABOUT.intro}</p>
        </Container>
      </section>

      <Container className="py-8">
        <SectionTitle eyebrow="What we believe" title="Our core values guide everything" />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {ABOUT.values.map(v => (
            <Card key={v.title}>
              <h3 className="text-base font-bold text-slate-900">{v.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{v.body}</p>
            </Card>
          ))}
        </div>
      </Container>

      <StatsBand />
      <CtaBand />
    </>
  );
}
