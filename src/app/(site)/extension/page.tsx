import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, MessageCircle, ShieldCheck, ShoppingBag, Sparkles, Users } from "lucide-react";
import { Container, Glow, SectionTitle, Card, GRADIENTS } from "../_components/ui";
import { Reveal } from "../_components/motion";
import { CtaBand } from "../_components/sections";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema, extensionSchema, EXTENSION_STORE_URL } from "../_content/schema";
import { EXTENSION_SEO } from "../_content/pageseo";

const PATH = "/extension";
const TITLE = "Talko Copilot Chrome Extension — Reply to WhatsApp & Instagram from Any Tab";
const DESCRIPTION = "Free Chrome extension for Talko AI. Capture leads from any webpage and reply on WhatsApp, Instagram, Messenger and web chat from a side panel, without switching tabs.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

type ExtFeature = { icon: React.ElementType; title: string; body: string };
const FEATURES: ExtFeature[] = [
  { icon: MessageCircle, title: "One inbox, any tab", body: "WhatsApp, Instagram, Facebook and website chat conversations open in a side panel — reply without leaving the page you're already on." },
  { icon: Users, title: "Customer context on demand", body: "See a contact's order count, lifetime spend and lead source the moment their conversation opens, no switching to the CRM." },
  { icon: ShoppingBag, title: "Sell without leaving the chat", body: "Search your product catalog, send an item with pricing, and generate a payment link — all from the same panel." },
  { icon: ClipboardList, title: "Capture leads from any webpage", body: "Highlight a name, email or phone number on any site and add it straight to Talko AI as a lead." },
  { icon: Sparkles, title: "AI-drafted replies", body: "Draft a reply grounded in your own knowledge base before you send it, on any channel the panel supports." },
  { icon: ShieldCheck, title: "Official APIs only", body: "Every message goes through WhatsApp's, Instagram's and Facebook's own APIs — no scraping, no browser automation, and WhatsApp's 24-hour window is enforced automatically." },
];

export default function ExtensionPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: EXTENSION_SEO.updated, published: EXTENSION_SEO.published })} />
      <JsonLd data={extensionSchema} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Chrome extension", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Free Chrome extension" title="Reply to customers without leaving the tab you're on"
            subtitle="Talko Copilot puts your WhatsApp, Instagram, Messenger and web-chat inbox in a Chrome side panel — plus one-click lead capture from any page you're browsing." />
          <div className="mx-auto mt-4 max-w-2xl space-y-3 text-left text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">Talko Copilot is a free Chrome extension that puts your Talko AI inbox in a side panel, reachable from any tab.</strong>{" "}
              It shows customer order history and lifetime spend, searches your product catalog to send items with pricing, drafts AI replies grounded
              in your knowledge base, and lets you capture a lead from any webpage by highlighting their contact details.
            </p>
            <p>
              It&apos;s for anyone running Talko AI who&apos;s often mid-task in a browser tab — a CRM, a marketplace listing, an email — when a customer message
              needs a reply. Every send goes through WhatsApp&apos;s, Instagram&apos;s and Facebook&apos;s own official APIs, the same rules (including WhatsApp&apos;s
              24-hour window) as the <Link href="/features" className="font-semibold text-[#0783fd] hover:underline">Talko AI web app</Link>.
            </p>
            <LastUpdated iso={EXTENSION_SEO.updated} />
          </div>

          <Reveal className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center justify-center gap-2 rounded-full ${GRADIENTS.brand} px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-[0_8px_24px_-10px_rgba(7,131,253,0.8)] transition-opacity hover:opacity-90`}>
              Add to Chrome — it&apos;s free
            </a>
            <Link href="/signup" className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#0783fd]">
              No Talko AI account yet? Start a free trial →
            </Link>
          </Reveal>
        </Container>
      </section>

      <Container className="pt-12 pb-4">
        <SectionTitle title="What Talko Copilot does" subtitle="Everything your inbox needs, without a tab switch." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 90} className="h-full">
              <Card className="h-full">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]">
                  <f.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Container>

      <Container className="py-16">
        <SectionTitle title="How to install it" eyebrow="Setup" id="how-to-install"
          subtitle="Two minutes, no developer needed." />
        <ol className="mx-auto mt-10 max-w-2xl list-none space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
          {[
            { n: 1, t: "Open the Chrome Web Store listing", d: "Click “Add to Chrome” above, or search “Talko Copilot” in the Chrome Web Store." },
            { n: 2, t: "Pin it to your toolbar", d: "Click the puzzle-piece icon in Chrome's toolbar and pin Talko Copilot so it's always one click away." },
            { n: 3, t: "Sign in with your Talko AI account", d: "Use the same login as the web app. If you don't have one yet, the 14-day free trial takes under a minute to start." },
            { n: 4, t: "Open the side panel and start replying", d: "Your WhatsApp, Instagram, Messenger and web-chat conversations load in the panel, on any tab." },
          ].map(s => (
            <li key={s.n} className="flex gap-3.5">
              <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#0783fd] text-[11px] font-bold text-white">{s.n}</span>
              <p className="text-sm leading-relaxed text-slate-600"><span className="font-semibold text-slate-900">{s.t}.</span> {s.d}</p>
            </li>
          ))}
        </ol>
      </Container>

      <Container className="py-16">
        <PageFaq items={EXTENSION_SEO.faqs} path={PATH} title="Questions about the Chrome extension" />
        <SourceList items={EXTENSION_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
