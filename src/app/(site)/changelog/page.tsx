import type { Metadata } from "next";
import Link from "next/link";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { KeyTakeaway, PageFaq, SourceList, formatIsoDate } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { CHANGELOG_SEO } from "../_content/pageseo";
import { CHANGELOG, type ChangeTag } from "../_content/changelog";

const PATH = "/changelog";
const TITLE = "Talko AI Changelog — What's New, Improved and Fixed";
const DESCRIPTION = "Every customer-visible change to Talko AI in plain language — new channels, features, improvements and fixes, logged the day they ship.";

// The newest entry IS the page's last-updated date, so it's read from the data
// rather than kept as a separate constant that would silently go stale the
// first time someone adds an entry and forgets to bump it.
const LATEST = CHANGELOG[0]?.date ?? CHANGELOG_SEO.published;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

// Brand hex + /10-opacity-background formula, matching every other tint on
// the site (TONES.violet, GRADIENTS, ICON_GRADIENTS all use #7c5cff) — not
// Tailwind's stock violet-600 (#7c3aed), a visibly different, off-brand purple.
const TAG_STYLES: Record<ChangeTag, string> = {
  New: "bg-[#0783fd]/10 text-[#0783fd]",
  Improved: "bg-[#7c5cff]/10 text-[#7c5cff]",
  Fixed: "bg-amber-50 text-amber-700",
};

// How releases actually reach an account — the operational detail behind the
// list, which the list alone doesn't convey.
const SHIPPING: string[] = [
  "Changes ship continuously in small increments, not as quarterly releases.",
  "Talko AI is hosted, so fixes and improvements reach your account with no upgrade step on your side.",
  "Anything that needs an action from you — connecting a new channel, switching on a setting that starts off — is called out in its own entry.",
  "Internal refactors, infrastructure and dependency work are deliberately not listed here, because nothing about them is visible to you.",
];

export default function ChangelogPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: LATEST, published: CHANGELOG_SEO.published })} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Changelog", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Changelog" title="What's new, improved and fixed in Talko AI"
            subtitle="New channels, features and fixes, as they ship — in plain language, not commit messages." />
          <KeyTakeaway updated={LATEST}>
            <p>
              <strong className="font-semibold text-slate-900">This page logs every customer-visible change to Talko AI, on the day it ships.</strong>{" "}
              Entries are tagged New, Improved or Fixed, and grouped by date with the most recent first. The latest release
              was {formatIsoDate(LATEST)}.
            </p>
            <p>
              It is for existing customers checking whether something they asked for has landed, and for anyone evaluating the platform who wants
              to see how actively it is developed. For the live health of the platform right now, see
              the <Link href="/status" className="font-semibold text-[#0783fd] hover:underline">system status page</Link> instead — this page covers
              what changed, not what is working at this moment.
            </p>
          </KeyTakeaway>
        </Container>
      </section>

      <Container className="py-12">
        <div className="mx-auto max-w-2xl">
          <ol className="relative space-y-12 border-l border-slate-200 pl-8">
            {CHANGELOG.map(day => (
              <li key={day.date} id={day.date} className="relative scroll-mt-24">
                <span aria-hidden className="absolute -left-[2.32rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-[#0783fd] shadow-[0_0_0_3px_rgba(7,131,253,0.15)]" />
                <time dateTime={day.date} className="text-xs font-bold uppercase tracking-wide text-slate-400">{formatIsoDate(day.date)}</time>
                <h2 className="mt-1.5 text-lg font-extrabold text-slate-900">{day.title}</h2>
                <ul className="mt-4 space-y-3">
                  {day.entries.map((e, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TAG_STYLES[e.tag]}`}>{e.tag}</span>
                      <p className="text-sm leading-relaxed text-slate-600">{e.text}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </Container>

      <Container className="py-12">
        <SectionTitle title="How we ship changes" eyebrow="Release process" id="how-we-ship"
          subtitle="What actually happens between a change being written and it reaching your account." />
        <ul className="mx-auto mt-10 max-w-2xl space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
          {SHIPPING.map(s => (
            <li key={s} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0783fd]" /> {s}
            </li>
          ))}
        </ul>
      </Container>

      <Container className="py-16">
        <PageFaq items={CHANGELOG_SEO.faqs} path={PATH} title="Questions about releases and updates" />
        <SourceList items={CHANGELOG_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
