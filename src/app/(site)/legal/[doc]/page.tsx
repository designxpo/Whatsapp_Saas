import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container, Glow } from "../../_components/ui";
import { CtaBand } from "../../_components/sections";
import { LEGAL_DOCS, LEGAL_NAV, LEGAL_EFFECTIVE, getLegalDoc } from "../../_content/legal";

// Anchor id for a section heading (e.g. "1. Agreement to these terms" → "agreement-to-these-terms").
const anchor = (heading: string) =>
  heading.replace(/^\d+\.\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function generateStaticParams() {
  return LEGAL_DOCS.map(d => ({ doc: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  const d = getLegalDoc(doc);
  if (!d) return { title: "Legal — Talko AI" };
  return { title: `${d.title} — Talko AI`, description: d.summary };
}

export default async function LegalDocPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = getLegalDoc(doc);
  if (!d) notFound();

  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Link href="/legal" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-[#0783fd]"><ArrowLeft className="h-4 w-4" /> All policies</Link>
          <div className="mx-auto mt-8 max-w-3xl text-center">
            <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">{d.title}</h1>
            <p className="mt-3 text-balance text-slate-500">{d.summary}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Last updated {LEGAL_EFFECTIVE}</p>
          </div>
        </Container>
      </section>

      <Container className="py-12">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[220px_1fr]">
          {/* Other policies + on-page contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Policies</p>
                <ul className="mt-3 space-y-1.5">
                  {LEGAL_NAV.map(n => (
                    <li key={n.slug}>
                      <Link href={`/legal/${n.slug}`} className={`text-sm transition-colors hover:text-[#0783fd] ${n.slug === d.slug ? "font-bold text-[#0783fd]" : "text-slate-600"}`}>{n.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">On this page</p>
                <ul className="mt-3 space-y-1.5">
                  {d.sections.map(s => (
                    <li key={s.heading}><a href={`#${anchor(s.heading)}`} className="text-xs leading-snug text-slate-500 transition-colors hover:text-[#0783fd]">{s.heading}</a></li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>

          <article className="min-w-0 max-w-2xl space-y-8">
            {d.sections.map(s => (
              <section key={s.heading} id={anchor(s.heading)} className="scroll-mt-24">
                <h2 className="text-lg font-bold tracking-tight text-slate-900">{s.heading}</h2>
                <div className="mt-3 space-y-3">
                  {s.blocks.map((b, i) =>
                    b.type === "p" ? (
                      <p key={i} className="leading-relaxed text-slate-600">{b.text}</p>
                    ) : (
                      <ul key={i} className="space-y-2 pl-1">
                        {b.items.map((it, j) => (
                          <li key={j} className="flex gap-2.5 leading-relaxed text-slate-600">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0783fd]" />
                            <span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              </section>
            ))}

            {/* Quick links to the other policies on mobile */}
            <div className="border-t border-slate-200 pt-6 lg:hidden">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Other policies</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {LEGAL_NAV.filter(n => n.slug !== d.slug).map(n => (
                  <Link key={n.slug} href={`/legal/${n.slug}`} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#0783fd]/40 hover:text-[#0783fd]">{n.label}</Link>
                ))}
              </div>
            </div>
          </article>
        </div>
      </Container>

      <CtaBand />
    </>
  );
}
