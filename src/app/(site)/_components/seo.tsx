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
