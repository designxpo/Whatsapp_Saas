import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container, Glow } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { POSTS } from "../../_content/site";

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }));
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

  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[#0783fd]"><ArrowLeft className="h-4 w-4" /> All articles</Link>
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
          {post.body.map((para, i) => (
            <p key={i} className={i === 0 ? "text-lg leading-relaxed text-slate-700" : "leading-relaxed text-slate-500"}>{para}</p>
          ))}
        </article>

        {more.length > 0 && (
          <div className="mx-auto mt-16 max-w-2xl border-t border-slate-200 pt-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Keep reading</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {more.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-[0_10px_24px_-12px_rgba(24,119,242,0.3)]">
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
