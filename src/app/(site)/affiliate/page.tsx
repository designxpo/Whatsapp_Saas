import type { Metadata } from "next";
import Link from "next/link";
import { Users, Percent, Wallet, Link2, UserPlus, TrendingUp, Check } from "lucide-react";
import { Container, Glow, SectionTitle, Card, GRADIENTS, Eyebrow } from "../_components/ui";
import { Reveal } from "../_components/motion";
import { CtaBand } from "../_components/sections";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { LastUpdated, PageFaq, SourceList } from "../_components/seo";
import { AffiliateForm } from "../_components/affiliate-form";
import { webPageSchema, affiliateProgramSchema } from "../_content/schema";
import { AFFILIATE_SEO } from "../_content/pageseo";

const PATH = "/affiliate";
const TITLE = "Talko AI Affiliate Program — Earn 10% Recurring Commission";
const DESCRIPTION = "Refer businesses to Talko AI and earn a 10% recurring commission on every subscription payment they make, for as long as they stay a customer. Free to join, no account required.";

export const metadata: Metadata = { title: TITLE, description: DESCRIPTION };

type Benefit = { icon: typeof Users; title: string; body: string };
const BENEFITS: Benefit[] = [
  { icon: Link2, title: "Get a unique referral link", body: "Every affiliate gets their own referral link the moment they join. Share it on your website, in a newsletter, on social media, or directly with a business you know." },
  { icon: TrendingUp, title: "Earn recurring commission", body: "10% of every subscription payment a business you referred makes — not a one-time bonus. As long as they stay a paying Talko AI customer, you keep earning from that one referral." },
  { icon: Wallet, title: "Track everything in your dashboard", body: "See exactly who signed up through your link, who converted to a paying plan, which plan they chose, and a running total of pending and paid commission — updated automatically." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Sign up for free", body: "Create an affiliate account in under a minute — no Talko AI subscription or existing account required." },
  { title: "Share your referral link", body: "Every affiliate gets a unique link (thetalko.in/signup?ref=YOURCODE). Share it however you already reach businesses that could use Talko AI." },
  { title: "A business signs up through your link", body: "When someone creates a Talko AI account through your link, they're permanently attributed to you — even if they sign up weeks after clicking." },
  { title: "You earn commission on every payment", body: "The moment that business's subscription payment goes through, 10% of it lands in your dashboard as commission — and again on every renewal, for as long as they stay subscribed." },
];

export default function AffiliatePage() {
  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: AFFILIATE_SEO.updated, published: AFFILIATE_SEO.published })} />
      <JsonLd data={affiliateProgramSchema} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Affiliate Program", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Free to join · no Talko AI account required"
            title="Refer businesses to Talko AI, earn recurring commission for as long as they stay"
            subtitle="Anyone can join the Talko AI Affiliate Program. Get a unique referral link, and earn 10% of every subscription payment made by a business you referred — every month, not just once." />

          <div className="mx-auto mt-6 max-w-2xl space-y-3 text-center text-sm leading-relaxed text-slate-500">
            <p>
              <strong className="font-semibold text-slate-900">The Talko AI Affiliate Program pays a 10% recurring commission</strong> on
              every subscription payment made by a business you refer, for as long as that business stays a paying customer —
              not a one-time payout like most referral programs.
            </p>
            <p>
              It&apos;s built for anyone who reaches small and medium businesses regularly: agencies, consultants, content
              creators, or existing Talko AI customers who know other businesses that would benefit. You don&apos;t need a{" "}
              <Link href="/pricing" className="font-semibold text-[#0783fd] hover:underline">Talko AI subscription</Link>{" "}
              yourself to join and start earning.
            </p>
            <LastUpdated iso={AFFILIATE_SEO.updated} />
          </div>
        </Container>
      </section>

      <Container className="pt-10 pb-16">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] items-start">
          <Reveal>
            <div className="rounded-3xl overflow-hidden shadow-[0_20px_60px_-20px_rgba(7,131,253,0.35)]">
              <div className={`${GRADIENTS.aurora} p-8 sm:p-10 text-white`}>
                <div className="flex items-baseline gap-3">
                  <span className="text-6xl sm:text-7xl font-extrabold tracking-tight">10%</span>
                  <span className="text-lg font-bold text-white/80">commission</span>
                </div>
                <p className="mt-2 text-white/90 font-semibold">On every subscription payment from a business you refer</p>
                <p className="mt-4 text-sm text-white/75 leading-relaxed max-w-md">
                  Paid on every renewal, not just the first sale — a business paying ₹4,999/month earns you
                  ₹499.90 every month they stay subscribed.
                </p>
              </div>
              <div className="bg-white p-6 sm:p-8 grid grid-cols-3 gap-4 text-center">
                {[
                  { icon: UserPlus, label: "Free to join" },
                  { icon: Link2, label: "One referral link" },
                  { icon: Wallet, label: "Tracked automatically" },
                ].map(f => (
                  <div key={f.label} className="flex flex-col items-center gap-1.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0783fd]/10 text-[#0783fd]"><f.icon className="h-4.5 w-4.5" /></span>
                    <span className="text-xs font-semibold text-slate-600">{f.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={90}><AffiliateForm /></Reveal>
        </div>
      </Container>

      <Container className="pt-4 pb-4">
        <SectionTitle title="Why join the Talko AI Affiliate Program" subtitle="Built to reward long-term relationships, not one-off referrals." />
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {BENEFITS.map((b, i) => (
            <Reveal key={b.title} delay={i * 90} className="h-full">
              <Card className="h-full">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]">
                  <b.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{b.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Container>

      <Container className="py-16">
        <SectionTitle title="How the affiliate program works" eyebrow="Step by step" id="how-it-works"
          subtitle="From signing up to earning your first commission." />
        <ol className="mx-auto mt-10 max-w-2xl list-none space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3.5">
              <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#0783fd] text-[11px] font-bold text-white">{i + 1}</span>
              <p className="text-sm leading-relaxed text-slate-600"><span className="font-semibold text-slate-900">{s.title}.</span> {s.body}</p>
            </li>
          ))}
        </ol>
      </Container>

      <Container className="pb-16">
        <Reveal>
          <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Who this is for</p>
            <ul className="mt-3 space-y-2">
              {[
                "Agencies and consultants who already recommend software to their SMB clients",
                "Content creators and educators whose audience runs a business on WhatsApp or Instagram",
                "Existing Talko AI customers who know other businesses facing the same messaging chaos",
                "Anyone with an audience of small and medium business owners — no Talko AI account needed to start",
              ].map(item => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-slate-600 leading-relaxed">
                  <Check className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" /><span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </Container>

      <Container className="py-16">
        <PageFaq items={AFFILIATE_SEO.faqs} path={PATH} title="Questions about the affiliate program" />
        <SourceList items={AFFILIATE_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
