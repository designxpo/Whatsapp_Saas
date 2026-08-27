import type { Metadata } from "next";
import Link from "next/link";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand, StatsBand } from "../_components/sections";
import { IndustrySections } from "../_components/industries";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { INDUSTRIES_SEO } from "../_content/pageseo";
import { INDUSTRIES } from "../_content/industries";
import { SITE_URL } from "@/lib/siteurl";

const PATH = "/industries";
const TITLE = "WhatsApp Automation by Industry — Talko AI";
// 154 chars. The previous 270-char version was truncated mid-sentence in
// results, so the benefit never survived to the search listing.
const DESCRIPTION = "Six industry playbooks for WhatsApp, Instagram and web chat automation — D2C, EdTech, healthcare, real estate, restaurants and travel, on one platform.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // No `openGraph` object: it would overwrite (not merge) the shared og:image
  // from (site)/opengraph-image.tsx. og:title/og:description auto-infer above.
};

export default function IndustriesPage() {
  // CollectionPage + ItemList: this page's job is to introduce and point at six
  // playbooks, so the accurate schema is an ordered list of them.
  const playbookList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}${PATH}#playbooks`,
    name: "Talko AI industry playbooks",
    itemListElement: INDUSTRIES.map((ind, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${ind.name} — ${ind.headline}`,
      url: `${SITE_URL}/industries/${ind.slug}`,
    })),
  };

  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: INDUSTRIES_SEO.updated, published: INDUSTRIES_SEO.published, extraTypes: ["CollectionPage"] })} />
      <JsonLd data={playbookList} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-10">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Industries", href: PATH }]} />
          {/* H1 now carries the title tag's own subject words — "WhatsApp",
              "automation", "industry", "Talko AI" — so the two describe the same
              topic instead of sharing only the brand name. */}
          <SectionTitle
            level={1}
            eyebrow="Industries"
            title="WhatsApp automation by industry — how businesses like yours run on Talko AI"
            subtitle="Six playbooks, one platform. The same building blocks — AI replies, chatbot flows, broadcasts, drips and payments — arranged for the way your industry actually sells and supports."
          />
          <div className="mx-auto mt-4 max-w-2xl space-y-3 text-left text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">An industry playbook is a documented arrangement of the same platform, tuned to one kind of business.</strong>{" "}
              Talko AI has six: D2C and e-commerce, EdTech, healthcare, real estate, restaurants and travel. Each one uses the identical
              building blocks — AI replies grounded on your own material, chatbot flows, broadcasts, drip sequences and in-chat payments —
              in the order that sector actually needs them.
            </p>
            <p>
              They&apos;re for businesses whose inbound messages have outgrown the people answering them, and they run on WhatsApp, Instagram,
              Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat. If your sector isn&apos;t one of the six,
              the nearest playbook is still a working starting point — most businesses adapt one rather than starting from nothing.
            </p>
            <LastUpdated iso={INDUSTRIES_SEO.updated} />
          </div>
        </Container>
      </section>

      <IndustrySections />

      {/* Every playbook above is a claim about somebody else's platform rules —
          Meta's opt-in and template policy, Google's review-reply rules — so the
          sources behind those claims are linked rather than asserted. */}
      <Container className="py-16">
        <PageFaq items={INDUSTRIES_SEO.faqs} path={PATH} title="Questions about the industry playbooks" />
        <p className="mx-auto mt-8 max-w-2xl text-sm leading-relaxed text-slate-500">
          Not sure which playbook fits? <Link href="/contact" className="font-semibold text-[#0783fd] hover:underline">Tell us what you sell</Link>{" "}
          and we&apos;ll point you at the closest one — or start from the{" "}
          <Link href="/guides" className="font-semibold text-[#0783fd] hover:underline">setup guides</Link> and switch on one piece at a time.
        </p>
        <SourceList items={INDUSTRIES_SEO.sources} className="mt-14" />
      </Container>

      <StatsBand />
      <CtaBand />
    </>
  );
}
