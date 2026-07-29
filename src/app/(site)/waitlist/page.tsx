import type { Metadata } from "next";
import { Container, Glow, GradientText, Eyebrow } from "../_components/ui";
import { WaitlistForm } from "../_components/waitlist-form";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Join the Waitlist — Early Access to Talko AI",
  description: "Be first on launch day. Tell us which plan fits and the channels you want to automate — WhatsApp, Instagram, Messenger, web chat and Google reviews. We'll set you up before anyone else.",
};

const PERKS = [
  "Priority onboarding on launch day",
  "Founder-led setup of your AI, channels & automations",
  "Lock in early-access pricing",
  "Bring your own AI key — predictable costs",
];

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan = "" } = await searchParams;
  return (
    <div className="relative overflow-hidden py-16 sm:py-24">
      <Glow className="left-1/2 top-0 -translate-x-1/2" />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Launching soon</Eyebrow>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Be first when we <GradientText>go live</GradientText>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-500">
            Leave your details and the plan you want. On launch day we&apos;ll email you and personally get your AI, channels and automations set up — before general access opens.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div className="lg:pt-2">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-400">What early access gets you</h2>
            <ul className="mt-4 space-y-3">
              {PERKS.map(p => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-slate-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0783fd]/10 text-[#0783fd]"><Check className="h-3 w-3" /></span>{p}
                </li>
              ))}
            </ul>
          </div>
          <WaitlistForm initialPlan={plan} />
        </div>
      </Container>
    </div>
  );
}
