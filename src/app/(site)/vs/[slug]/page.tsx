import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, Glow, Eyebrow, Button } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { VsComparison, WhySwitch, VsFaq, OtherComparisons } from "../../_components/vs";
import { COMPETITORS } from "../../_content/site";

export function generateStaticParams() {
  return COMPETITORS.map(c => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = COMPETITORS.find(x => x.slug === slug);
  if (!c) return { title: "Comparison — Talko AI" };
  const title = `Talko AI vs ${c.name}: Features, Pricing & the Best Alternative (2026)`;
  const description = `${c.name} vs Talko AI — ${c.summary}`.slice(0, 158);
  return {
    title,
    description,
    // Also targets "<competitor> alternative" queries.
    keywords: [`${c.name} alternative`, `Talko AI vs ${c.name}`, `${c.name} vs Talko AI`],
    // No `openGraph` object here on purpose: Next OVERWRITES (never deep-merges)
    // the openGraph field, so setting it would wipe the og:image injected by
    // (site)/opengraph-image.tsx. Leaving it off lets Next auto-derive og:title /
    // og:description from the title/description above while inheriting the image.
  };
}

export default async function VsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = COMPETITORS.find(x => x.slug === slug);
  if (!c) notFound();

  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-14 pb-6">
          <Breadcrumbs items={[
            { name: "Home", href: "/" },
            { name: "Compare", href: "/vs" },
            { name: `vs ${c.name}`, href: `/vs/${c.slug}` },
          ]} />
          <div className="mt-6 max-w-3xl">
            <Eyebrow>Talko AI vs {c.name}</Eyebrow>
            <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{c.headline}</h1>
            <p className="mt-5 text-balance text-lg leading-relaxed text-slate-600">{c.summary}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/signup">Start your free trial</Button>
              <Button href="/pricing" variant="ghost">See pricing</Button>
            </div>
          </div>
        </Container>
      </section>

      <VsComparison competitor={c} />
      <WhySwitch competitor={c} />
      <VsFaq competitor={c} />
      <OtherComparisons currentSlug={c.slug} />
      <CtaBand />
    </>
  );
}
