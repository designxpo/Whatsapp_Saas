import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Rocket, Plug, Workflow, LifeBuoy, CheckCircle2 } from "lucide-react";
import { Container, Glow, SectionTitle, Card } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { GUIDES_SEO } from "../_content/pageseo";
import { GUIDES, type Guide } from "../_content/guides";
import { SITE_URL } from "@/lib/siteurl";

const PATH = "/guides";
const TITLE = "Talko AI Setup Guides — Connect Every Channel Yourself";
const DESCRIPTION = "Step-by-step guides for connecting WhatsApp, Instagram, Messenger, YouTube, Google reviews and website chat to Talko AI — no developer needed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

const CATEGORIES: { key: Guide["category"]; label: string; blurb: string; icon: typeof Rocket }[] = [
  { key: "Getting started", label: "Getting started", blurb: "Your first day with Talko AI, start to finish.", icon: Rocket },
  { key: "Connect a channel", label: "Connect a channel", blurb: "Bring each channel your customers use into one inbox.", icon: Plug },
  { key: "Automate", label: "Automate", blurb: "Set up the AI and flows that do the work for you.", icon: Workflow },
];

// Everything you need in hand before starting, in one checklist — so the answer
// to "what do I need first" doesn't require opening five guides to assemble.
const PREREQS: string[] = [
  "Admin access to your own Meta Business account, for WhatsApp, Instagram or Messenger.",
  "The phone number, Instagram professional account or Facebook Page you want to connect.",
  "An AI provider key from Gemini, OpenAI or Anthropic — replies are billed to your account, not resold by us.",
  "For YouTube comment automation: the Google account that owns the channel.",
  "For Google review replies: owner or manager access to the Business Profile listing.",
  "For the website widget: the ability to paste one line of HTML into your site.",
];

// Who each track is written for, so a reader can pick a starting point instead
// of reading three categories to find out which applies to them.
const AUDIENCE: { who: string; body: string }[] = [
  { who: "Setting up for the first time", body: "Start with Getting started. It covers the account, your first channel and your first automated reply in one pass — about half an hour end to end, most of it Meta's verification screens rather than anything in Talko AI." },
  { who: "Adding another channel", body: "Go straight to Connect a channel and pick the one you need. Each guide is self-contained and assumes your account already exists, so nothing is repeated from the first-time path." },
  { who: "Switching automation on", body: "Read the Automate track. It covers grounding the AI on your own material, building a flow, and scheduling sequences and broadcasts within the platforms' sending rules." },
  { who: "Fixing something broken", body: "Skip to the troubleshooting guide, which is organised by symptom rather than feature — find what you're seeing, read the cause and the fix." },
];

export default function GuidesPage() {
  const guideList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}${PATH}#guides`,
    name: "Talko AI setup guides",
    itemListElement: GUIDES.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: g.title,
      url: `${SITE_URL}/guides/${g.slug}`,
    })),
  };

  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: GUIDES_SEO.updated, published: GUIDES_SEO.published, extraTypes: ["CollectionPage"] })} />
      <JsonLd data={guideList} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Guides", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Guides" title="Setup guides — connect every channel to Talko AI yourself, step by step"
            subtitle="Plain-language guides for connecting every channel and turning on automation — no developer needed. Most take five to ten minutes." />
          <div className="mx-auto mt-6 max-w-2xl space-y-3 text-center text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">You can set up Talko AI without a developer.</strong>{" "}
              Each guide below is a numbered walkthrough of one task — connecting a channel, grounding the AI, building a flow — with its own
              time estimate and prerequisites. Most take five to ten minutes; a realistic first session is about half an hour, and most of that
              is Meta&apos;s own verification screens rather than anything inside Talko AI.
            </p>
            <p>
              Written for business owners, marketers and support leads setting this up themselves, not for engineers. If something is already
              broken, the <Link href="/guides/troubleshooting" className="font-semibold text-[#0783fd] hover:underline">troubleshooting guide</Link> is
              organised by symptom and will get you there faster.
            </p>
            <LastUpdated iso={GUIDES_SEO.updated} />
          </div>
        </Container>
      </section>

      <Container className="pt-12 pb-4">
        <SectionTitle title="What you need before you start" eyebrow="Checklist" id="before-you-start"
          subtitle="Gather these once and every guide below goes faster." />
        <ul className="mx-auto mt-10 max-w-2xl space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
          {PREREQS.map(p => (
            <li key={p} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0783fd]" aria-hidden="true" /> {p}
            </li>
          ))}
        </ul>
      </Container>

      {CATEGORIES.map(cat => {
        const items = GUIDES.filter(g => g.category === cat.key);
        if (!items.length) return null;
        const Icon = cat.icon;
        return (
          <Container key={cat.key} className="py-8">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><Icon className="h-5 w-5" /></span>
              <div>
                <h2 id={cat.key.toLowerCase().replace(/\s+/g, "-")} className="scroll-mt-24 text-lg font-extrabold text-slate-900">{cat.label}</h2>
                <p className="text-sm text-slate-500">{cat.blurb}</p>
              </div>
            </div>
            <div className="mx-auto mt-6 grid max-w-5xl gap-5 md:grid-cols-2 lg:grid-cols-3">
              {items.map(g => (
                <Link key={g.slug} href={`/guides/${g.slug}`}
                  className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_12px_30px_-12px_rgba(7,131,253,0.3)]">
                  <h3 className="text-base font-bold leading-snug text-slate-900 group-hover:text-[#0783fd]">{g.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{g.summary}</p>
                  <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                    <span>{g.timeEstimate}</span>
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        );
      })}

      {/* Not part of the step-by-step Guide set (it's symptom/cause/fix, not a
          walkthrough) — surfaced as its own card rather than forced into a
          category above it doesn't belong in. */}
      <Container className="py-8">
        <Link href="/guides/troubleshooting"
          className="group mx-auto flex max-w-3xl items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_12px_30px_-12px_rgba(7,131,253,0.3)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><LifeBuoy className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 group-hover:text-[#0783fd]">Something not working? Troubleshooting</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">Symptom, cause and fix for the issues that come up most — WhatsApp, Instagram, YouTube, Reviews, AI replies and billing.</p>
          </div>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#0783fd]" />
        </Link>
      </Container>

      <Container className="py-12">
        <SectionTitle title="Which guide should you start with?" eyebrow="Pick a starting point" id="where-to-start"
          subtitle="Four situations, and the track each one points to." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {AUDIENCE.map(a => (
            <Card key={a.who} className="h-full">
              <h3 className="text-base font-bold text-slate-900">{a.who}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{a.body}</p>
            </Card>
          ))}
        </div>
      </Container>

      <Container className="py-16">
        <PageFaq items={GUIDES_SEO.faqs} path={PATH} title="Questions about setting up Talko AI" />
        <SourceList items={GUIDES_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
