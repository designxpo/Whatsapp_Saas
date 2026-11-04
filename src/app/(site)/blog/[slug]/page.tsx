import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { BlogCoverImage } from "../../_components/blog-cover-image";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container, Glow } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { JsonLd } from "../../_components/json-ld";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { PageFaq, SourceList } from "../../_components/seo";
import { AUTHOR, POSTS, type PostBlock } from "../../_content/site";
import { TemplateChecker } from "../../_components/template-checker";
import { SupportHandoffPlanner } from "../../_components/support-handoff-planner";
import { SITE_URL } from "@/lib/siteurl";

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }));
}

// Inline links allow internal paths and HTTPS citations only. Other schemes
// remain plain text; no raw HTML is interpreted.
// Anything that isn't that exact pattern renders as plain text, untouched.
const INLINE_LINK = /\[([^\]]+)\]\((\/(?!\/)[^)]+|https:\/\/[^)]+)\)/g;
function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_LINK.lastIndex = 0;
  while ((m = INLINE_LINK.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[2].startsWith("https://")
      ? <a key={m.index} href={m[2]} className="font-semibold text-[#026cd4] hover:underline">{m[1]}</a>
      : <Link key={m.index} href={m[2]} className="font-semibold text-[#026cd4] hover:underline">{m[1]}</Link>);
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
        if (b.type === "h2") return <h2 id={`section-${i}`} key={i} className="!mt-10 scroll-mt-32 text-xl font-extrabold text-slate-900">{renderInline(b.text)}</h2>;
        if (b.type === "h3") return <h3 key={i} className="text-base font-bold text-slate-900">{renderInline(b.text)}</h3>;
        if (b.type === "tool") {
          // Interactive widgets are keyed by id so _content/site.ts stays pure
          // data — no JSX, no client imports in the content layer.
          return b.id === "template-checker" ? <TemplateChecker key={i} /> : <SupportHandoffPlanner key={i} />;
        }
        if (b.type === "image") return (
          <figure key={i} className="not-prose my-8">
            <Image src={b.src} alt={b.alt} width={b.width} height={b.height} sizes="(min-width: 768px) 672px, 100vw" className="h-auto w-full rounded-2xl border border-slate-200" />
            <figcaption className="mt-3 text-xs leading-relaxed text-slate-500">{b.caption}</figcaption>
          </figure>
        );
        if (b.type === "table") return (
          <div key={i} className="not-prose overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} role="region" aria-label={b.caption}>
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="p-4 text-left font-semibold text-slate-800">{b.caption}</caption>
              <thead className="bg-[#0783fd]/5"><tr>{b.headers.map(header => <th scope="col" key={header} className="border-t border-slate-200 px-4 py-3 font-bold text-slate-800">{header}</th>)}</tr></thead>
              <tbody>{b.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0
                ? <th scope="row" key={column} className="border-t border-slate-200 px-4 py-3 align-top font-semibold text-slate-800">{renderInline(cell)}</th>
                : <td key={column} className="border-t border-slate-200 px-4 py-3 align-top leading-relaxed text-slate-600">{renderInline(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
        if (b.type === "callout") {
          const warn = b.tone === "warn";
          return (
            <aside key={i} className={`not-prose rounded-2xl border px-5 py-4 ${warn ? "border-amber-200 bg-amber-50" : "border-[#0783fd]/20 bg-[#0783fd]/5"}`}>
              <p className={`text-sm font-bold ${warn ? "text-amber-900" : "text-[#026cd4]"}`}>{b.title}</p>
              <p className={`mt-1.5 text-sm leading-relaxed ${warn ? "text-amber-900/90" : "text-slate-600"}`}>{renderInline(b.text)}</p>
            </aside>
          );
        }
        if (b.type === "compare") {
          // Two WhatsApp-style bubbles. A rejected template beside its fix
          // teaches the rule faster than a paragraph about the rule.
          return (
            <figure key={i} className="not-prose my-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: b.badLabel, text: b.bad, bad: true },
                  { label: b.goodLabel, text: b.good, bad: false },
                ].map(c => (
                  <div key={c.label} className={`overflow-hidden rounded-2xl border ${c.bad ? "border-red-200" : "border-emerald-200"}`}>
                    <p className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wide ${c.bad ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{c.label}</p>
                    <div className="bg-[#e4ddd4] p-3">
                      <div className="max-w-[94%] rounded-xl rounded-tl-sm bg-white px-3 py-2 font-mono text-[12.5px] leading-snug text-slate-800 shadow-sm">{c.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              {b.caption && <figcaption className="mt-2.5 text-center text-xs text-slate-400">{b.caption}</figcaption>}
            </figure>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="list-disc space-y-2 pl-5 marker:text-[#026cd4]">
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
  // Point og:image at this post's own generated cover, so a share on WhatsApp
  // or LinkedIn previews THIS article rather than the identical site-wide card
  // every post used to fall back to.
  const cover = `${SITE_URL}${post.shareImage ?? `/blog/${post.slug}/cover`}`;
  return {
    title: `${post.title} — Talko AI`,
    description: post.excerpt,
    alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.excerpt, url: `${SITE_URL}/blog/${post.slug}`, publishedTime: new Date(post.date).toISOString(), modifiedTime: new Date(post.dateModified ?? post.date).toISOString(), images: [{ url: cover, width: 1200, height: 630, alt: post.title }] },
    twitter: { card: "summary_large_image", images: [cover] },
  };
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
    image: `${SITE_URL}${post.shareImage ?? `/blog/${post.slug}/cover`}`,
    url: `${SITE_URL}/blog/${post.slug}`,
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    // The Organization, by the owner's choice. Declaring a Person named
    // "Talko AI" would be false structured data, so the type follows the name.
    author: { "@type": "Organization", name: AUTHOR.name, url: SITE_URL },
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
          <Link href="/blog" className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[#026cd4]"><ArrowLeft className="h-4 w-4" /> All articles</Link>
          <div className="mx-auto mt-8 max-w-3xl text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-[#0783fd]/10 px-2.5 py-1 font-bold text-[#026cd4]">{post.category}</span>
              <span>{post.date} · {post.readTime}</span>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              By the <Link href={AUTHOR.url} className="font-semibold text-slate-700 hover:text-[#026cd4]">{AUTHOR.name}</Link> team
            </div>
            <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">{post.title}</h1>
          </div>
          <figure className="relative mx-auto mt-10 aspect-[1200/630] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <BlogCoverImage slug={post.slug} title={post.title} priority sizes="(min-width: 1024px) 896px, 100vw" />
          </figure>
          {post.coverCaption && <p className="mx-auto mt-3 max-w-4xl text-xs text-slate-500">{post.coverCaption}</p>}
        </Container>
      </section>

      <Container className="py-12">
        <article className="mx-auto max-w-2xl space-y-6">
          {post.showContents && <nav aria-label="In this article" className="rounded-2xl border border-slate-200 bg-white p-5">
            <details><summary className="cursor-pointer text-sm font-bold text-slate-700">In this article</summary>
            <ul className="mt-3 space-y-2 text-sm">{post.body.map((block, index) => block.type === "h2" ? <li key={index}><a href={`#section-${index}`} className="text-[#026cd4] hover:underline">{block.text}</a></li> : null)}</ul>
            </details>
          </nav>}
          <BlockRenderer blocks={post.body} />
        </article>

        {(post.faqs?.length || post.sources?.length) ? (
          <div className="mx-auto mt-16 max-w-2xl border-t border-slate-200 pt-10">
            {!!post.faqs?.length && <PageFaq items={post.faqs} path={`/blog/${post.slug}`} id={`faq-${post.slug}`} />}
            {!!post.sources?.length && <SourceList items={post.sources} className={post.faqs?.length ? "mt-14" : ""} />}
          </div>
        ) : null}

        <div className="mx-auto mt-16 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Who writes this</p>
          <p className="mt-2 text-sm font-bold text-slate-900">{AUTHOR.name}</p>
          <p className="text-xs text-slate-500">{AUTHOR.role}</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{AUTHOR.bio}</p>
        </div>

        {more.length > 0 && (
          <div className="mx-auto mt-16 max-w-2xl border-t border-slate-200 pt-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Keep reading</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {more.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-[0_10px_24px_-12px_rgba(7,131,253,0.3)]">
                  <div className="text-xs font-bold text-[#026cd4]">{p.category}</div>
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
