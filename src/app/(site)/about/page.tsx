import type { Metadata } from "next";
import { Container, Glow, SectionTitle, Card, Eyebrow } from "../_components/ui";
import { StatsBand, CtaBand } from "../_components/sections";
import { Reveal } from "../_components/motion";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { KeyTakeaway, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { ABOUT_SEO } from "../_content/pageseo";
import { ABOUT } from "../_content/site";

const PATH = "/about";
const TITLE = "About Talko AI — Why We Built a Conversation Platform";
const DESCRIPTION = "Talko AI helps businesses turn WhatsApp, Instagram, Messenger, YouTube and website conversations into growth — compliantly, transparently, and at scale.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

export default function AboutPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: ABOUT_SEO.updated, published: ABOUT_SEO.published })} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-8">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "About", href: PATH }]} />
          <div className="text-center">
            <div className="mt-6 flex justify-center"><Eyebrow>{ABOUT.eyebrow}</Eyebrow></div>
            <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">{ABOUT.title}</h1>
            <p className="mx-auto mt-5 max-w-2xl text-balance text-slate-600">{ABOUT.intro}</p>
          </div>
          <KeyTakeaway updated={ABOUT_SEO.updated}>
            <p>
              <strong className="font-semibold text-slate-900">Talko AI is a customer conversation platform, built and operated by PM Technologies.</strong>{" "}
              It brings WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat into one
              inbox, and answers them with AI grounded on your own knowledge base.
            </p>
            <p>
              It is for businesses whose inbound messages have outgrown the people answering them — D2C and retail brands, service and local
              businesses, education and healthcare providers, agencies and creators. Every channel runs on its owner&apos;s official API, and AI
              replies run on your own provider key, so your data and your costs both stay yours.
            </p>
          </KeyTakeaway>
        </Container>
      </section>

      <Container className="py-12">
        <SectionTitle eyebrow="The short version" title="What Talko AI does" id="what-we-do" />
        <div className="mx-auto mt-8 max-w-2xl space-y-4">
          {ABOUT.what.map(p => <p key={p} className="text-sm leading-relaxed text-slate-600">{p}</p>)}
        </div>
      </Container>

      <Container className="py-12">
        <SectionTitle eyebrow="Why we built it" title="The problem we set out to fix" id="why"
          subtitle="What we saw businesses actually doing before there was a tool that fit." />
        <div className="mx-auto mt-8 max-w-2xl space-y-4">
          {ABOUT.story.map(p => <p key={p} className="text-sm leading-relaxed text-slate-600">{p}</p>)}
        </div>
      </Container>

      <Container className="py-8">
        <SectionTitle eyebrow="What we believe" title="Our core values guide everything" id="values" />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {ABOUT.values.map((v, i) => (
            <Reveal key={v.title} delay={(i % 2) * 90} className="h-full">
              <Card className="h-full">
                <h3 className="text-base font-bold text-slate-900">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{v.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Container>

      <Container className="py-12">
        <SectionTitle eyebrow="Who it's for" title="The businesses we build for" id="audience"
          subtitle="Different industries, one shared problem: more inbound messages than people to answer them." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {ABOUT.audience.map(a => (
            <Card key={a.who} className="h-full">
              <h3 className="text-base font-bold text-slate-900">{a.who}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{a.body}</p>
            </Card>
          ))}
        </div>
      </Container>

      <Container className="py-12">
        <SectionTitle eyebrow="Commitments" title="How we stay compliant and transparent" id="commitments"
          subtitle="Each of these is checkable against the platform rules it follows — the sources are listed below." />
        <div className="mx-auto mt-10 max-w-2xl divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {ABOUT.commitments.map(c => (
            <div key={c.title} className="px-6 py-5">
              <h3 className="text-sm font-bold text-slate-900">{c.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{c.body}</p>
            </div>
          ))}
        </div>
      </Container>

      <Container className="py-16">
        <PageFaq items={ABOUT_SEO.faqs} path={PATH} title="Questions about Talko AI and who runs it" />
        <SourceList items={ABOUT_SEO.sources} className="mt-14" />
      </Container>

      <StatsBand />
      <CtaBand />
    </>
  );
}
