import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Glow, Eyebrow } from "../_components/ui";
import { ComparisonTable, CtaBand } from "../_components/sections";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { COMPETITORS } from "../_content/site";

const title = "Talko AI Alternatives & Comparisons — WATI, AiSensy, ManyChat & more";
const description = "See how Talko AI compares to WATI, AiSensy, Interakt, Respond.io, ManyChat and Tidio — every channel in one inbox, AI on your own key. Side-by-side capability tables.";

export const metadata: Metadata = {
  title,
  description,
  // No `openGraph` object: it would overwrite (not merge) the shared og:image
  // from (site)/opengraph-image.tsx. og:title/og:description auto-infer above.
};

export default function VsIndexPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-200px] -translate-x-1/2" />
        <Container className="relative pt-14 pb-6">
          <Breadcrumbs items={[
            { name: "Home", href: "/" },
            { name: "Compare", href: "/vs" },
          ]} />
          <div className="mt-6 max-w-3xl">
            <Eyebrow>Compare Talko AI</Eyebrow>
            <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              How Talko AI compares to the tools you&rsquo;re evaluating
            </h1>
            <p className="mt-5 text-balance text-lg leading-relaxed text-slate-600">
              Each tool below is excellent in its core lane. Talko AI&rsquo;s edge is doing all of it in one
              platform — WhatsApp, Instagram, Messenger and website chat in a single inbox, with AI grounded
              on your knowledge base and running on your own AI key. Pick a comparison to see the detail.
            </p>
          </div>
        </Container>
      </section>

      <section className="pt-4 pb-6">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COMPETITORS.map(c => (
              <Link key={c.slug} href={`/vs/${c.slug}`}
                className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(7,131,253,0.25)]">
                <span>
                  <span className="block text-base font-extrabold text-slate-900">Talko AI vs {c.name}</span>
                  <span className="block text-xs text-slate-500">{c.category}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-[#0783fd]" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <ComparisonTable />
      <CtaBand />
    </>
  );
}
