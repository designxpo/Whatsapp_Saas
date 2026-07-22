// Server-safe building blocks for the /vs competitor comparison pages. All
// static → no "use client", so every page ships as pure SSG HTML (best for SEO
// and AI answer engines). The focused table is derived from COMPARE_ROWS by the
// competitor's column index, so it can never drift from the homepage matrix.
import Link from "next/link";
import { Check, X, Minus, ArrowRight } from "lucide-react";
import { Container, SectionTitle, Card, GradientText } from "./ui";
import { JsonLd } from "./json-ld";
import { COMPARE_COLS, COMPARE_ROWS, COMPARE_NOTE, COMPETITORS, type Competitor } from "../_content/site";
import { SITE_URL } from "@/lib/siteurl";

// Same a11y contract as the homepage CompareCell: icon cells carry an sr-only
// "Yes"/"No" so they scrape as real text for screen readers AND answer engines.
function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#2f9e6e]/12 text-[#2f9e6e]"><Check className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Yes</span></span>;
  if (value === false) return <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-300"><X className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">No</span></span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><Minus className="h-3 w-3 shrink-0 text-slate-300" aria-hidden="true" />{value}</span>;
}

// Focused two-column table: Talko AI (col 0) vs this competitor's column.
export function VsComparison({ competitor }: { competitor: Competitor }) {
  const ci = COMPARE_COLS.indexOf(competitor.name as (typeof COMPARE_COLS)[number]);
  const talkoScore = COMPARE_ROWS.filter(r => r.values[0] === true).length;
  const rivalScore = COMPARE_ROWS.filter(r => r.values[ci] === true).length;
  const total = COMPARE_ROWS.length;
  return (
    <section className="py-14">
      <Container>
        <SectionTitle eyebrow="Side by side"
          title={`Talko AI vs ${competitor.name}, capability by capability`}
          subtitle={`Every row is drawn from the same capability matrix we publish for all channels. ${competitor.name} is excellent in its lane — here's where a single all-channel platform pulls ahead.`} />
      </Container>
      <div className="mx-auto mt-10 w-full max-w-3xl px-4 sm:px-8">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table aria-label={`Talko AI compared with ${competitor.name}`} className="w-full min-w-[520px] table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="w-[52%] px-4 py-3.5 text-[13px] font-bold text-slate-900">Capability</th>
                <th scope="col" className="rounded-t-xl bg-gradient-to-br from-[#0783fd] to-[#6a5cff] px-3 py-3.5 text-center text-[13px] font-bold text-white">Talko AI</th>
                <th scope="col" className="px-3 py-3.5 text-center text-[13px] font-bold text-slate-500">{competitor.name}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row, ri) => (
                <tr key={row.feature} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                  <th scope="row" className="px-4 py-3 text-left text-[12.5px] font-medium leading-snug text-slate-700">{row.feature}</th>
                  <td className="bg-[#0783fd]/5 px-3 py-3 text-center"><Cell value={row.values[0]} /></td>
                  <td className="px-3 py-3 text-center"><Cell value={row.values[ci]} /></td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-white">
                <td className="px-4 py-3.5 text-[12.5px] font-extrabold text-slate-900">Capabilities included</td>
                <td className="bg-[#0783fd]/5 px-3 py-3.5 text-center"><span className="text-sm font-extrabold text-[#0783fd]">{talkoScore}</span><span className="text-[11px] font-semibold text-slate-400">/{total}</span></td>
                <td className="px-3 py-3.5 text-center"><span className="text-sm font-extrabold text-slate-400">{rivalScore}</span><span className="text-[11px] font-semibold text-slate-400">/{total}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-slate-500">{COMPARE_NOTE}</p>
      </div>
    </section>
  );
}

// "Why teams switch" — the curated differentiators for this competitor.
export function WhySwitch({ competitor }: { competitor: Competitor }) {
  return (
    <section className="py-8">
      <Container>
        <SectionTitle title={`Why teams move from ${competitor.name} to Talko AI`} />
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {competitor.whySwitch.map(r => (
            <Card key={r.title}>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0783fd]/10 text-[#0783fd]"><Check className="h-5 w-5" /></span>
              <h3 className="mt-4 text-base font-extrabold text-slate-900">{r.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{r.body}</p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}

// FAQ block + FAQPage JSON-LD (AEO: lets Google and answer engines extract the
// Q&A directly). Visible copy and schema come from the same array.
export function VsFaq({ competitor }: { competitor: Competitor }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: competitor.faqs.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <section className="py-12">
      <Container>
        <JsonLd data={schema} />
        <SectionTitle title={`Talko AI vs ${competitor.name} — FAQ`} />
        <dl className="mx-auto mt-10 max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {competitor.faqs.map(f => (
            <div key={f.q} className="p-6">
              <dt className="text-sm font-extrabold text-slate-900">{f.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

// Cross-link grid to the other comparisons — internal linking equity + lets a
// visitor find the tool they're actually evaluating against.
export function OtherComparisons({ currentSlug }: { currentSlug: string }) {
  const others = COMPETITORS.filter(c => c.slug !== currentSlug);
  return (
    <section className="py-12">
      <Container>
        <SectionTitle title="Compare Talko AI with other tools" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.map(c => (
            <Link key={c.slug} href={`/vs/${c.slug}`}
              className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(7,131,253,0.25)]">
              <span>
                <span className="block text-sm font-extrabold text-slate-900">Talko AI vs {c.name}</span>
                <span className="block text-xs text-slate-500">{c.category}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-[#0783fd]" aria-hidden="true" />
            </Link>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-slate-500">
          Want the full picture? <Link href="/vs" className="font-bold text-[#0783fd] hover:underline">See every comparison</Link> or read <GradientText>why teams choose Talko AI</GradientText>.
        </p>
      </Container>
    </section>
  );
}
