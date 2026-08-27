import type { Metadata } from "next";
import Link from "next/link";
import { Container, Glow, SectionTitle, Eyebrow } from "../_components/ui";
import { ContactForm } from "../_components/contact-form";
import { LifeBuoy, Rocket, HelpCircle, CheckCircle2 } from "lucide-react";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { CONTACT_SEO } from "../_content/pageseo";

const PATH = "/contact";
const TITLE = "Contact Talko AI — Sales, Support & Partnerships";
const DESCRIPTION = "Contact Talko AI about pricing, setup, partnerships or press. A real person replies within one business day — or check the guides for a faster fix.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

const REASONS: { icon: typeof Rocket; title: string; body: string; link?: { label: string; href: string } }[] = [
  {
    icon: Rocket, title: "Sales",
    body: "Curious which plan fits, or want a walkthrough before you commit? Tell us your rough monthly message volume and which channels you need — WhatsApp, Instagram, Messenger, YouTube, Google reviews or web chat — and we'll point at a plan rather than a feature tour.",
    link: { label: "See pricing first", href: "/pricing" },
  },
  {
    icon: LifeBuoy, title: "Support",
    body: "Something not working? The troubleshooting guide is organised by symptom and resolves most cases faster than we can, because you don't have to wait for a reply. If nothing is sending at all, check system status before writing in.",
    link: { label: "Troubleshooting guide", href: "/guides/troubleshooting" },
  },
  {
    icon: HelpCircle, title: "Everything else",
    body: "Partnerships, reseller and agency arrangements, press, or anything that doesn't fit a form field — just tell us what you need. Agencies: mention how many client brands you manage and we'll quote the right structure.",
    link: { label: "Read about us", href: "/about" },
  },
];

// What happens after the form is submitted. Removes the main reason people
// don't send a message: not knowing whether anyone is on the other end.
const AFTER: string[] = [
  "Your message goes to the team that builds the product, not an outsourced desk or a ticket queue.",
  "Sales and general enquiries get a reply within one business day; support usually the same day during Indian business hours.",
  "If it's a support issue we can reproduce, you'll get the fix or the workaround in the first reply rather than a request for more detail.",
  "If it's a feature request, it goes on the list — and lands on the changelog when it ships.",
];

// Self-serve answers that beat waiting for a reply, each pointing somewhere
// specific. Also the internal-link layer this page previously lacked.
const FASTER: { q: string; href: string; label: string }[] = [
  { q: "How much does it cost, and what's in each plan?", href: "/pricing", label: "Pricing and plans" },
  { q: "How do I connect WhatsApp, Instagram or my website?", href: "/guides", label: "Setup guides" },
  { q: "Something stopped working — what do I check?", href: "/guides/troubleshooting", label: "Troubleshooting by symptom" },
  { q: "Is the platform running normally right now?", href: "/status", label: "System status" },
  { q: "Did the thing I asked for ship yet?", href: "/changelog", label: "Changelog" },
  { q: "What can this actually automate?", href: "/features", label: "Features" },
];

export default function ContactPage() {
  return (
    <>
      {/* ContactPage is the accurate WebPage subtype here, and the Organization's
          ContactPoint (email, support type, languages) already ships site-wide
          from the layout — so this page inherits it rather than restating it. */}
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: CONTACT_SEO.updated, published: CONTACT_SEO.published, extraTypes: ["ContactPage"] })} />

      <section className="relative overflow-hidden pt-16">
        <Glow className="left-1/2 top-0 -translate-x-1/2" />
        <Container className="relative">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Contact", href: PATH }]} />
          <div className="mx-auto mt-6 max-w-2xl text-center">
            <Eyebrow>Get in touch</Eyebrow>
            <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Contact the Talko AI team — sales, support, partnerships</h1>
            <p className="mx-auto mt-4 max-w-xl text-base text-slate-500">
              Sales question, stuck on setup, or something else entirely — send it here and a real person replies, not a bot.
            </p>
            <div className="mt-6 space-y-3 text-center text-sm leading-relaxed text-slate-500">
              <p>
                <strong className="font-semibold text-slate-900">Email info@thetalko.in or use the form below.</strong>{" "}
                Sales and general enquiries get a reply within one business day; support is usually same-day during Indian business hours. Talko AI
                is built and operated by PM Technologies, and the people who answer are the ones who build the product.
              </p>
              <p>
                Talko AI is a customer conversation platform for WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile
                reviews and website chat — used by D2C and retail brands, service and local businesses, education and healthcare providers, agencies
                and creators. If your question is &quot;something isn&apos;t working&quot;, the{" "}
                <Link href="/guides/troubleshooting" className="font-semibold text-[#0783fd] hover:underline">troubleshooting guide</Link> will
                usually answer it faster than we can.
              </p>
              <LastUpdated iso={CONTACT_SEO.updated} />
            </div>
          </div>
        </Container>
      </section>

      <Container className="pt-14 pb-8">
        <SectionTitle title="What are you getting in touch about?" eyebrow="Reach us" id="reasons"
          subtitle="Three routes in. Say which one you're on and the first reply will be a useful one." />
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div className="space-y-6 lg:pt-2">
            {REASONS.map(r => (
              <div key={r.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><r.icon className="h-4 w-4" /></span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">{r.title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{r.body}</p>
                  {r.link && <Link href={r.link.href} className="mt-1.5 inline-block text-xs font-bold text-[#0783fd] hover:underline">{r.link.label} →</Link>}
                </div>
              </div>
            ))}
          </div>
          <ContactForm />
        </div>
      </Container>

      <Container className="py-12">
        <SectionTitle title="What happens after you send this" eyebrow="No black box" id="what-happens" />
        <ol className="mx-auto mt-10 max-w-2xl space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
          {AFTER.map((a, i) => (
            <li key={a} className="flex items-start gap-3 text-sm leading-relaxed text-slate-600">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0783fd] text-[11px] font-extrabold text-white">{i + 1}</span>
              {a}
            </li>
          ))}
        </ol>
      </Container>

      <Container className="py-12">
        <SectionTitle title="Can you answer it faster than we can?" eyebrow="Before you write in" id="self-serve"
          subtitle="These six questions have a page each — no waiting for a reply." />
        <ul className="mx-auto mt-10 max-w-2xl divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {FASTER.map(f => (
            <li key={f.href} className="flex flex-col gap-1.5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0783fd]" aria-hidden="true" /> {f.q}
              </span>
              <Link href={f.href} className="shrink-0 text-xs font-bold text-[#0783fd] hover:underline sm:text-right">{f.label} →</Link>
            </li>
          ))}
        </ul>
      </Container>

      <Container className="py-16">
        <PageFaq items={CONTACT_SEO.faqs} path={PATH} title="Questions about contacting us" />
        <SourceList items={CONTACT_SEO.sources} className="mt-14" />
      </Container>
    </>
  );
}
