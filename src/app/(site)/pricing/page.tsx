import type { Metadata } from "next";
import Link from "next/link";
import { Container, Glow, SectionTitle, Card } from "../_components/ui";
import { Testimonials, CtaBand } from "../_components/sections";
import { PricingTiers } from "../_components/pricing";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { PRICING_SEO, BIZ_RANGE, CREATOR_RANGE, CREATOR_FLOOR, ANNUAL_OFF } from "../_content/pageseo";
import { CREATOR_TIERS } from "../_content/site";

const PATH = "/pricing";
// "from ₹999" is the site-wide floor and holds — but that floor is the
// Instagram-first Creator tier, so the description must not imply ₹999 buys the
// WhatsApp stack. It doesn't; the cheapest business plan is ₹1,999.
const TITLE = "Talko AI Pricing — Plans from ₹999/mo & Free Trial";
const DESCRIPTION = "Talko AI pricing: Instagram-first Creator plans from ₹999/mo, WhatsApp business plans from ₹1,999/mo. 14-day free trial, no card, cancel anytime.";

export const metadata: Metadata = {
  // NOTE: the root title template does NOT reach page.tsx segments under
  // (site)/ (only the (site) layout's own title) — so bake the brand in here.
  title: TITLE,
  description: DESCRIPTION,
  // No `openGraph` object: Next overwrites (never merges) it per segment, so
  // setting one would wipe the shared og:image from (site)/opengraph-image.tsx.
  // Omitting it lets og:title/og:description auto-infer from the fields above.
};

// Who each plan is actually for. Pricing pages fail readers (and AI answer
// engines) at exactly this step: they list what you get, never who should buy
// which. Ordered by how most visitors self-identify, not by price.
const FITS: { who: string; use: string; plan: string }[] = [
  {
    who: "D2C & retail brands",
    use: "Customers ask about stock, sizes and delivery in chat, then order there. You need catalog checkout, order updates and broadcasts to past buyers.",
    plan: "A business plan — WhatsApp is where the orders happen.",
  },
  {
    who: "Service & local businesses",
    use: "Clinics, salons, real estate, travel and repair services booking appointments and answering the same twenty questions daily, plus Google reviews to keep answered.",
    plan: "A business plan — flows for booking, AI for the questions.",
  },
  {
    who: "Creators & influencers",
    use: "Instagram DMs and comments are the whole business. You want comment-to-DM automation, keyword replies and link-in-bio capture — not a WhatsApp business stack.",
    plan: "A Creator plan — Instagram-first, from ₹999/mo.",
  },
  {
    who: "Agencies & multi-brand teams",
    use: "Several client accounts, each with its own channels, knowledge base, AI key and team, kept fully isolated from one another.",
    plan: "Scale — quoted per account rather than stacking subscriptions.",
  },
];

export default function PricingPage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: PRICING_SEO.updated, published: PRICING_SEO.published })} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Pricing", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Pricing" title="Simple, transparent Talko AI pricing — plans from ₹999/mo"
            subtitle="Every plan includes a 14-day free trial. AI replies run on your own provider key, so usage costs stay yours and predictable." />
          <div className="mx-auto mt-4 max-w-2xl space-y-3 text-left text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">Business plans run {BIZ_RANGE}; Creator plans, which are Instagram-first, run {CREATOR_RANGE}; Scale is quoted per account.</strong>{" "}
              Annual billing takes {ANNUAL_OFF} off any of them. Every plan starts with a 14-day free trial and no credit card.
            </p>
            <p>
              Two costs sit outside your subscription, and both are billed to you directly rather than marked up by us: Meta&apos;s
              per-conversation WhatsApp fees, and your AI provider&apos;s usage on the Gemini, OpenAI or Anthropic key you bring. That is
              what &quot;transparent&quot; means here — you can see each line separately instead of one bundled number.
            </p>
            <LastUpdated iso={PRICING_SEO.updated} />
          </div>
        </Container>
      </section>

      <Container className="pt-12 pb-8">
        {/* H2 before the tier cards' H3 plan names — the page previously went
            H1 → H3 here with no section heading in between. */}
        <SectionTitle title="Business plans" eyebrow="For teams" id="business-plans"
          subtitle="Every channel, one inbox. Pick by monthly message volume and how many numbers you need." />
        <div className="mt-12"><PricingTiers /></div>
        {/* Was "Need annual billing? Talk to sales" — which contradicted the
            annual toggle directly above it. Annual is self-serve; only volume
            pricing needs a conversation. */}
        <p className="mt-8 text-center text-xs text-slate-500">Prices in INR. Annual billing saves {ANNUAL_OFF} — use the toggle above. Need a custom volume or several brands? <Link href="/contact" className="font-semibold text-[#0783fd] hover:underline">Talk to sales.</Link></p>
      </Container>

      {/* Audience → plan mapping. Answers "which one should I buy", which the
          tier table alone never does. */}
      <Container className="py-12">
        <SectionTitle title="Which plan fits your business?" eyebrow="Decide faster" id="which-plan"
          subtitle="Four situations that cover most of who signs up, and the plan each one points to." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {FITS.map(f => (
            <Card key={f.who} className="h-full">
              <h3 className="text-base font-bold text-slate-900">{f.who}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.use}</p>
              <p className="mt-3 text-sm font-semibold text-[#0783fd]">{f.plan}</p>
            </Card>
          ))}
        </div>
      </Container>

      {/* Instagram-first plans for creators & influencers */}
      <Container className="py-12">
        <div className="rounded-[28px] bg-slate-50 px-5 py-12 sm:px-10">
          <SectionTitle eyebrow="For creators & influencers"
            title="Instagram-first plans for creators"
            subtitle="No WhatsApp business stack to pay for — just the Instagram DM & comment automation creators actually need. Reply to every DM, turn comments into DMs, and capture leads on autopilot." />
          <PricingTiers tiers={CREATOR_TIERS} showToggle={false} />
          <p className="mt-8 text-center text-xs text-slate-500">Need WhatsApp too? See the business plans above — or <span className="font-semibold text-[#0783fd]">talk to sales</span> for a custom mix.</p>
        </div>
      </Container>

      <Testimonials />

      {/* Billing-specific questions rather than the shared site FAQ the
          homepage already publishes: a visitor here wants trial, message-fee
          and cancellation answers, and duplicating the same FAQPage across two
          URLs splits the signal between them. */}
      <Container className="py-16">
        <PageFaq items={PRICING_SEO.faqs} path={PATH} title="Pricing and billing questions" />
        <SourceList items={PRICING_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
