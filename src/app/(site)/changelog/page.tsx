import type { Metadata } from "next";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { CHANGELOG, type ChangeTag } from "../_content/changelog";

export const metadata: Metadata = {
  title: "Changelog — Talko AI",
  description: "What's new in Talko AI — new channels, features and fixes, in plain language, as they ship.",
};

// Brand hex + /10-opacity-background formula, matching every other tint on
// the site (TONES.violet, GRADIENTS, ICON_GRADIENTS all use #7c5cff) — not
// Tailwind's stock violet-600 (#7c3aed), a visibly different, off-brand purple.
const TAG_STYLES: Record<ChangeTag, string> = {
  New: "bg-[#0783fd]/10 text-[#0783fd]",
  Improved: "bg-[#7c5cff]/10 text-[#7c5cff]",
  Fixed: "bg-amber-50 text-amber-700",
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function ChangelogPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Changelog" title="What's new in Talko AI"
            subtitle="New channels, features and fixes, as they ship — in plain language, not commit messages." />
        </Container>
      </section>

      <Container className="py-12">
        <div className="mx-auto max-w-2xl">
          <ol className="relative space-y-12 border-l border-slate-200 pl-8">
            {CHANGELOG.map(day => (
              <li key={day.date} id={day.date} className="relative scroll-mt-24">
                <span aria-hidden className="absolute -left-[2.32rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-[#0783fd] shadow-[0_0_0_3px_rgba(7,131,253,0.15)]" />
                <time dateTime={day.date} className="text-xs font-bold uppercase tracking-wide text-slate-400">{formatDate(day.date)}</time>
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

      <CtaBand />
    </>
  );
}
