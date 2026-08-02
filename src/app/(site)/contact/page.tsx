import type { Metadata } from "next";
import Link from "next/link";
import { Container, Glow, Eyebrow } from "../_components/ui";
import { ContactForm } from "../_components/contact-form";
import { LifeBuoy, Rocket, HelpCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact Us — Talko AI",
  description: "Questions about pricing, setup, or a partnership? Reach the Talko AI team directly.",
};

const REASONS: { icon: typeof Rocket; title: string; body: string; link?: { label: string; href: string } }[] = [
  { icon: Rocket, title: "Sales", body: "Curious which plan fits, or want a walkthrough before you commit? Ask here." },
  { icon: LifeBuoy, title: "Support", body: "Something not working? Check the troubleshooting guide first — it covers the most common issues.", link: { label: "Troubleshooting guide", href: "/guides/troubleshooting" } },
  { icon: HelpCircle, title: "Everything else", body: "Partnerships, press, or anything that doesn't fit a form field — just tell us." },
];

export default function ContactPage() {
  return (
    <div className="relative overflow-hidden py-16 sm:py-24">
      <Glow className="left-1/2 top-0 -translate-x-1/2" />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Get in touch</Eyebrow>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Talk to the Talko AI team</h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-500">
            Sales question, stuck on setup, or something else entirely — send it here and a real person replies, not a bot.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div className="space-y-5 lg:pt-2">
            {REASONS.map(r => (
              <div key={r.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><r.icon className="h-4 w-4" /></span>
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">{r.title}</h2>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{r.body}</p>
                  {r.link && <Link href={r.link.href} className="mt-1 inline-block text-xs font-bold text-[#0783fd] hover:underline">{r.link.label} →</Link>}
                </div>
              </div>
            ))}
          </div>
          <ContactForm />
        </div>
      </Container>
    </div>
  );
}
