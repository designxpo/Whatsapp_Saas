import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { FeatureGrid, ThreeSteps, IntegrationsGrid, StatsBand, CtaBand, ProblemSolution, ComparisonTable } from "../_components/sections";
import { AgentCanvas } from "../_components/canvas";
import { FlowShowcase } from "../_components/flowshowcase";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { FEATURES_SEO } from "../_content/pageseo";

const PATH = "/features";
const TITLE = "WhatsApp & Instagram Automation Features — Talko AI";
// 158 chars — inside the 110–165 band search engines actually render, where the
// previous 181-char version was being truncated mid-sentence in results.
const DESCRIPTION = "AI replies, broadcasts, chatbot flows, drip sequences, catalog checkout and a unified inbox for WhatsApp, Instagram, Messenger, YouTube and web chat.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // No `openGraph` object: it would overwrite (not merge) the shared og:image
  // from (site)/opengraph-image.tsx. og:title/og:description auto-infer above.
};

export default function FeaturesPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: FEATURES_SEO.updated, published: FEATURES_SEO.published })} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Features", href: PATH }]} />
          {/* H1 carries the title tag's own subject words — "WhatsApp",
              "Instagram", "automation", "features" — so the two describe the
              same topic without being the same string. Matching plural forms
              matters: "feature" and "features" don't count as the same term. */}
          <SectionTitle level={1} eyebrow="Features" title="All the WhatsApp and Instagram automation features, in one platform"
            subtitle="From the first hello to repeat purchases — Talko AI automates the whole conversation across WhatsApp, Instagram, Messenger, YouTube and your website, and keeps your Google reviews answered." />
          <div className="mx-auto mt-4 max-w-2xl space-y-3 text-left text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">Talko AI automates customer conversations on six channels from one place:</strong>{" "}
              WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and a web-chat widget for your own site.
              Conversation automation means an incoming message is read, understood and answered — or escalated to a person — without someone
              watching an inbox for it.
            </p>
            <p>
              It is built for businesses whose message volume has outgrown their team: D2C and retail brands selling in chat, service
              businesses booking appointments, education and healthcare providers answering the same questions all day, agencies running
              several client accounts, and creators buried in Instagram DMs. AI replies run on your own provider key, so usage costs stay yours.
            </p>
            <LastUpdated iso={FEATURES_SEO.updated} />
          </div>
        </Container>
      </section>

      {/* An H2 before the feature cards' H3s — without it the page jumps
          straight from H1 to H3, which breaks the heading outline crawlers and
          screen readers both walk. */}
      <Container className="pt-12 pb-8">
        <SectionTitle title="What you can automate" eyebrow="Capabilities" id="capabilities"
          subtitle="The building blocks below work on every connected channel, not one at a time." />
        <div className="mt-12"><FeatureGrid /></div>
      </Container>

      <AgentCanvas />
      <FlowShowcase />
      <ProblemSolution />
      <ComparisonTable />
      <ThreeSteps />
      <IntegrationsGrid />
      <StatsBand />

      <Container className="py-16">
        <PageFaq items={FEATURES_SEO.faqs} path={PATH} title="Questions about what Talko AI can do" />
        <SourceList items={FEATURES_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
