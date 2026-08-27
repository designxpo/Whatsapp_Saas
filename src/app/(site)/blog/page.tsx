import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { BLOG_SEO } from "../_content/pageseo";
import { POSTS } from "../_content/site";
import { SITE_URL } from "@/lib/siteurl";

const PATH = "/blog";
const TITLE = "WhatsApp & Instagram Automation Blog — Talko AI";
const DESCRIPTION = "Playbooks, product updates and compliance guides for automating WhatsApp, Instagram, Messenger, YouTube, Google reviews and website chat.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // No `openGraph` object: it would overwrite (not merge) the shared og:image
  // from (site)/opengraph-image.tsx. og:title/og:description auto-infer above.
};

// What each category on this index actually means. An index page is mostly
// links, which gives a reader (or an answer engine) nothing to work with about
// the subject itself — these definitions are the substance behind the list.
const TOPICS: { name: string; body: string }[] = [
  {
    name: "Playbooks",
    body: "End-to-end approaches to a business outcome rather than a feature: recovering abandoned carts over WhatsApp, qualifying leads before a sales call, turning Instagram comments into booked appointments. Each one states the setup, the sequence and what to measure.",
  },
  {
    name: "Compliance",
    body: "What the platforms actually permit. Opt-in requirements, Meta's template approval categories, the 24-hour customer service window, and the difference between a message that gets delivered and one that gets your number rate-limited. Written against the published rules, which are linked at the bottom of each post.",
  },
  {
    name: "Channel deep-dives",
    body: "One channel at a time — how Instagram's messaging permissions differ from Messenger's, why YouTube comment automation needs a Google project, what Google Business Profile allows in a review reply.",
  },
  {
    name: "Product updates",
    body: "The reasoning behind notable releases, for the changes that need more than a changelog line to explain. Every shipped change is logged on the changelog; the ones worth a discussion land here.",
  },
];

export default function BlogPage() {
  // CollectionPage + ItemList: this page's job is to point at the articles, so
  // the accurate schema describes an ordered list of them — not a fabricated
  // Article about the index itself.
  const postList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}${PATH}#posts`,
    name: "Talko AI blog posts",
    itemListElement: POSTS.map((p, i) => {
      const t = Date.parse(p.dateModified ?? p.date);
      return {
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/blog/${p.slug}`,
        item: {
          "@type": "BlogPosting",
          "@id": `${SITE_URL}/blog/${p.slug}#post`,
          headline: p.title,
          description: p.excerpt,
          url: `${SITE_URL}/blog/${p.slug}`,
          articleSection: p.category,
          ...(Number.isFinite(t) ? { datePublished: new Date(t).toISOString().slice(0, 10) } : {}),
        },
      };
    }),
  };

  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: BLOG_SEO.updated, published: BLOG_SEO.published, extraTypes: ["CollectionPage"] })} />
      <JsonLd data={postList} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Blog", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Blog" title="The Talko AI blog: WhatsApp and Instagram automation playbooks"
            subtitle="Playbooks, product updates and compliance guides to help you get more from every conversation." />
          <div className="mx-auto mt-6 max-w-2xl space-y-3 text-center text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">This blog covers how to automate customer messaging without breaking platform rules.</strong>{" "}
              Expect setup playbooks, channel deep-dives and compliance explainers for WhatsApp, Instagram, Facebook Messenger, YouTube comments,
              Google Business Profile reviews and website chat.
            </p>
            <p>
              It is written for owners and marketers who answer customer messages themselves, support and sales leads deciding what to automate
              first, agencies running messaging for clients, and creators keeping up with Instagram DMs. For step-by-step setup instructions
              instead of context, see the <Link href="/guides" className="font-semibold text-[#0783fd] hover:underline">setup guides</Link>; for what
              shipped recently, the <Link href="/changelog" className="font-semibold text-[#0783fd] hover:underline">changelog</Link>.
            </p>
            <LastUpdated iso={BLOG_SEO.updated} />
          </div>
        </Container>
      </section>

      {/* H2 before the card H3s — the page previously went H1 → H3 with no
          section heading between them. */}
      <Container className="pt-12 pb-12">
        <SectionTitle title="Latest articles" eyebrow="Reading list" id="latest" />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {POSTS.map(p => (
            <Link key={p.slug} href={`/blog/${p.slug}`}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_12px_30px_-12px_rgba(7,131,253,0.3)]">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-[#0783fd]/10 px-2.5 py-1 font-bold text-[#0783fd]">{p.category}</span>
                <span>{p.readTime}</span>
              </div>
              <h3 className="mt-4 text-lg font-bold leading-snug text-slate-900 group-hover:text-[#0783fd]">{p.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{p.excerpt}</p>
              <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                <span>{p.date}</span>
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </Container>

      <Container className="py-12">
        <SectionTitle title="What you'll find here" eyebrow="Topics" id="topics"
          subtitle="Four kinds of post, and what each one is for." />
        <dl className="mx-auto mt-10 max-w-2xl divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {TOPICS.map(t => (
            <div key={t.name} className="px-6 py-5">
              <dt><h3 className="text-sm font-bold text-slate-900">{t.name}</h3></dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-slate-500">{t.body}</dd>
            </div>
          ))}
        </dl>
      </Container>

      <Container className="py-16">
        <PageFaq items={BLOG_SEO.faqs} path={PATH} title="About this blog" />
        <SourceList items={BLOG_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
