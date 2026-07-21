import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, Glow } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { IndustryDetail, OtherIndustries } from "../../_components/industries";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { INDUSTRIES } from "../../_content/industries";

export function generateStaticParams() {
  return INDUSTRIES.map(i => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const ind = INDUSTRIES.find(i => i.slug === slug);
  if (!ind) return { title: "Industry — Talko AI" };
  const title = `${ind.name} WhatsApp Automation — Talko AI`;
  const description = `${ind.headline} — ${ind.story.slice(0, 120)}`.slice(0, 158);
  // No `openGraph` object: it would overwrite (not merge) the shared og:image
  // from (site)/opengraph-image.tsx. og:title/og:description auto-infer below.
  return { title, description };
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = INDUSTRIES.findIndex(i => i.slug === slug);
  const ind = INDUSTRIES[index];
  if (!ind) notFound();

  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-14 pb-2">
          <Breadcrumbs items={[
            { name: "Home", href: "/" },
            { name: "Industries", href: "/industries" },
            { name: ind.navLabel, href: `/industries/${ind.slug}` },
          ]} />
        </Container>
      </section>

      <IndustryDetail ind={ind} index={index} />
      <OtherIndustries currentSlug={ind.slug} />
      <CtaBand />
    </>
  );
}
