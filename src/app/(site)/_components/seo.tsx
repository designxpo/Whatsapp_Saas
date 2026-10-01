// Presentational building blocks for the things answer engines (Google AI
// Overviews, ChatGPT, Perplexity) look for and ordinary marketing pages omit:
// a real question→answer block, a visible freshness date, and cited sources.
// The bottom-line "what is this" summary these used to accompany (KeyTakeaway)
// is deliberately NOT a separate component any more — it now lives as the
// page's own opening paragraph. A self-contained answer near the top of a page
// is what answer-engine extraction rewards; a labeled callout box around it
// was never the mechanism, so removing the box costs nothing as long as the
// sentence itself stays early in the real copy.
//
// Each one renders visible content AND, where relevant, the matching JSON-LD —
// bundled together on purpose. The alternative (schema in the page, copy in a
// component) is how schema silently drifts out of sync with what's on screen,
// which is the one structured-data mistake Google penalises.

import { ExternalLink } from "lucide-react";
import { JsonLd } from "./json-ld";
import { faqPageSchema, type FaqItem } from "../_content/schema";

/**
 * The page's definitional summary, collapsed behind a question.
 *
 * Every page carried two intro blocks stacked: an editorial lede, then a
 * plain-language "X is a Y for Z" paragraph written for answer engines. Both
 * say the same thing to a reader, so the second one reads as padding under the
 * first — on ten pages.
 *
 * Deleting it is the wrong fix: that paragraph is the one self-contained
 * statement an AI answer engine can quote, and on several pages it is also the
 * `speakable` target. A native <details> keeps the page clean AND keeps the
 * text in the document.
 *
 * It must be <details>, not CSS. Text hidden from people but served to
 * crawlers is cloaking — a named Google spam policy whose penalty is removal
 * from the index. Collapsed content is indexed normally, and the difference
 * that makes it legitimate is simply that a reader can open it.
 *
 * `question` is per-page on purpose. A question heading with its answer
 * directly beneath is the shape answer engines extract from, so "How much does
 * Talko AI cost?" on /pricing is worth more than a generic label everywhere.
 */
export function PageSummary({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details className="group mx-auto mt-6 max-w-2xl">
      <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-[#0783fd] [&::-webkit-details-marker]:hidden">
        {question}
        <svg className="h-3 w-3 transition-transform group-open:rotate-180" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-3 space-y-3 text-center text-sm leading-relaxed text-slate-500">{children}</div>
    </details>
  );
}

// Shared ISO → "5 August 2026" formatter. UTC-pinned so the rendered date is
// identical on the server and in every reader's timezone (a bare
// `new Date("2026-08-05")` renders as the 4th west of Greenwich).
export function formatIsoDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

// Visible freshness signal, paired with the `dateModified` in the page's
// WebPage schema — both read the same constant, so they can never disagree.
export function LastUpdated({ iso, className = "" }: { iso: string; className?: string }) {
  return (
    <p className={`text-xs text-slate-400 ${className}`}>
      Last updated <time dateTime={iso}>{formatIsoDate(iso)}</time>
    </p>
  );
}

// Question → answer, with the answer in the DOM directly after its heading and
// never collapsed. The accordion used elsewhere on the site hides answers
// behind a click; this variant is for pages where extractability matters more
// than compactness.
export function PageFaq({
  items, path, title = "Frequently asked questions", id = "faq",
}: { items: FaqItem[]; path: string; title?: string; id?: string }) {
  return (
    <>
      <JsonLd data={faqPageSchema(items, path)} />
      <div className="mx-auto max-w-2xl">
        <h2 id={id} className="scroll-mt-24 text-lg font-extrabold text-slate-900">{title}</h2>
        <dl className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map(f => (
            <div key={f.q} className="px-6 py-5">
              {/* <dt>/<dd> keeps the question bound to its answer structurally,
                  not just visually — but the question still needs to be a real
                  heading to register as a question-style heading, hence the h3. */}
              <dt><h3 className="text-sm font-bold text-slate-900">{f.q}</h3></dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

export type Source = { label: string; href: string; note?: string };

// Outbound citations to the primary sources behind the page's factual claims —
// Meta's, Google's and YouTube's own documentation. Every channel Talko AI
// automates is somebody else's platform with published rules, so linking those
// rules is the honest way to support a claim about them.
export function SourceList({ items, className = "" }: { items: Source[]; className?: string }) {
  return (
    <div className={`mx-auto max-w-2xl ${className}`}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sources</h2>
      <ul className="mt-3 space-y-2">
        {items.map(s => (
          <li key={s.href} className="text-xs leading-relaxed text-slate-500">
            <a href={s.href} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-baseline gap-1 font-semibold text-[#0783fd] hover:underline">
              {s.label}
              <ExternalLink className="h-3 w-3 shrink-0 translate-y-[1px]" aria-hidden="true" />
            </a>
            {s.note && <span> — {s.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
