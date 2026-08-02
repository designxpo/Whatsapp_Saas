import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, CheckCircle2, Lightbulb } from "lucide-react";
import { Container, Glow } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { JsonLd } from "../../_components/json-ld";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { GUIDES } from "../../_content/guides";
import { SITE_URL } from "@/lib/siteurl";

export function generateStaticParams() {
  return GUIDES.map(g => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = GUIDES.find(g => g.slug === slug);
  if (!guide) return { title: "Guide — Talko AI" };
  return { title: `${guide.title} — Talko AI`, description: guide.summary };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = GUIDES.find(g => g.slug === slug);
  if (!guide) notFound();
  const more = GUIDES.filter(g => g.slug !== slug && g.category === guide.category).slice(0, 3);

  // HowTo schema — this page genuinely IS a sequence of steps to complete a
  // task, unlike a homepage or blog post, so HowTo is the accurate type here
  // (not a forced fit like it would be elsewhere on the site).
  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: guide.title,
    description: guide.summary,
    step: guide.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  };

  const faqSchema = guide.faqs?.length ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faqs.map(f => ({
      "@type": "Question",
      name: f.q,
      text: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } : null;

  return (
    <>
      <JsonLd data={howToSchema} />
      {faqSchema && <JsonLd data={faqSchema} />}

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[
            { name: "Home", href: "/" },
            { name: "Guides", href: "/guides" },
            { name: guide.title, href: `/guides/${guide.slug}` },
          ]} />
          <Link href="/guides" className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[#0783fd]"><ArrowLeft className="h-4 w-4" /> All guides</Link>
          <div className="mx-auto mt-8 max-w-2xl text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-[#0783fd]/10 px-2.5 py-1 font-bold text-[#0783fd]">{guide.category}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {guide.timeEstimate}</span>
            </div>
            <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">{guide.title}</h1>
            <p className="mt-4 text-balance leading-relaxed text-slate-500">{guide.summary}</p>
          </div>
        </Container>
      </section>

      <Container className="py-10">
        <div className="mx-auto max-w-2xl">
          {guide.before && guide.before.length > 0 && (
            <div className="mb-10 rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Before you start</h2>
              <ul className="mt-3 space-y-2">
                {guide.before.map(b => (
                  <li key={b} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0783fd]" /> {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ol className="list-none space-y-8">
            {guide.steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0783fd] text-sm font-extrabold text-white">{i + 1}</span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {guide.tip && (
            <div className="mt-10 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <p className="text-sm leading-relaxed text-amber-900">{guide.tip}</p>
            </div>
          )}

          {guide.faqs && guide.faqs.length > 0 && (
            <div className="mt-14">
              <h2 className="text-lg font-extrabold text-slate-900">Common questions</h2>
              <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {guide.faqs.map(f => (
                  <div key={f.q} className="px-6 py-5">
                    <h3 className="text-sm font-bold text-slate-900">{f.q}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {more.length > 0 && (
          <div className="mx-auto mt-16 max-w-2xl border-t border-slate-200 pt-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Keep going</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {more.map(g => (
                <Link key={g.slug} href={`/guides/${g.slug}`} className="rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700 transition-colors hover:border-[#0783fd]/40 hover:text-[#0783fd]">
                  {g.title}
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
