import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container, Glow } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { JsonLd } from "../../_components/json-ld";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { PageFaq, SourceList } from "../../_components/seo";
import { POSTS, type PostBlock } from "../../_content/site";
import { SITE_URL } from "@/lib/siteurl";

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }));
}

// The only inline formatting a post body supports: `[label](/path)`, so an
// internal link can live in plain data without pulling in a Markdown renderer.
// Anything that isn't that exact pattern renders as plain text, untouched.
const INLINE_LINK = /\[([^\]]+)\]\((\/[^)]+)\)/g;
function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_LINK.lastIndex = 0;
  while ((m = INLINE_LINK.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<Link key={m.index} href={m[2]} className="font-semibold text-[#0783fd] hover:underline">{m[1]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function BlockRenderer({ blocks }: { blocks: PostBlock[] }) {
  // The first paragraph carries the lede treatment (larger, darker text);
  // every block after it uses body copy — matches the pre-existing style.
  let seenFirstP = false;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "h2") return <h2 key={i} className="!mt-10 text-xl font-extrabold text-slate-900">{renderInline(b.text)}</h2>;
        if (b.type === "h3") return <h3 key={i} className="text-base font-bold text-slate-900">{renderInline(b.text)}</h3>;
        if (b.type === "list") {
          return (
            <ul key={i} className="list-disc space-y-2 pl-5 marker:text-[#0783fd]">
              {b.items.map((item, j) => <li key={j} className="leading-relaxed text-slate-500">{renderInline(item)}</li>)}
            </ul>
          );
        }
        const isLede = !seenFirstP;
        seenFirstP = true;
        return <p key={i} className={isLede ? "text-lg leading-relaxed text-slate-700" : "leading-relaxed text-slate-500"}>{renderInline(b.text)}</p>;
      })}
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS.find(p => p.slug === slug);
  if (!post) return { title: "Article — Talko AI" };
  return { title: `${post.title} — Talko AI`, description: post.excerpt };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = POSTS.find(p => p.slug === slug);
  if (!post) notFound();
  const more = POSTS.filter(p => p.slug !== slug).slice(0, 2);

  // BlogPosting schema — lets AI engines attribute and cite the article, and
  // enables article rich results. `date` is a human string ("June 12, 2026");
  // Date.parse handles it, and we emit an ISO date when parseable.
  const parsed = Date.parse(post.date);
  const parsedMod = Date.parse(post.dateModified ?? post.date);
  const blogSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    ...(Number.isFinite(parsed) ? { datePublished: new Date(parsed).toISOString() } : {}),
    ...(Number.isFinite(parsedMod) ? { dateModified: new Date(parsedMod).toISOString() } : {}),
    articleSection: post.category,
    image: `${SITE_URL}/brand/talkopng.png`,
    url: `${SITE_URL}/blog/${post.slug}`,
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    author: { "@type": "Organization", name: "Talko AI" },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  return (
    <>
      <JsonLd data={blogSchema} />
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[
            { name: "Home", href: "/" },
            { name: "Blog", href: "/blog" },
            { name: post.title, href: `/blog/${post.slug}` },
          ]} />
          <Link href="/blog" className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[#0783fd]"><ArrowLeft className="h-4 w-4" /> All articles</Link>
          <div className="mx-auto mt-8 max-w-3xl text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-[#0783fd]/10 px-2.5 py-1 font-bold text-[#0783fd]">{post.category}</span>
              <span>{post.date} · {post.readTime}</span>
            </div>
            <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">{post.title}</h1>
          </div>
        </Container>
      </section>

      <Container className="py-12">
        <article className="mx-auto max-w-2xl space-y-6">
          <BlockRenderer blocks={post.body} />
        </article>

        {(post.faqs?.length || post.sources?.length) ? (
          <div className="mx-auto mt-16 max-w-2xl border-t border-slate-200 pt-10">
            {!!post.faqs?.length && <PageFaq items={post.faqs} path={`/blog/${post.slug}`} id={`faq-${post.slug}`} />}
            {!!post.sources?.length && <SourceList items={post.sources} className={post.faqs?.length ? "mt-14" : ""} />}
          </div>
        ) : null}

        {more.length > 0 && (
          <div className="mx-auto mt-16 max-w-2xl border-t border-slate-200 pt-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Keep reading</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {more.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-[0_10px_24px_-12px_rgba(7,131,253,0.3)]">
                  <div className="text-xs font-bold text-[#0783fd]">{p.category}</div>
                  <div className="mt-2 text-sm font-bold leading-snug text-slate-900">{p.title}</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Container>

      <CtaBand />
    </>
  );
}
