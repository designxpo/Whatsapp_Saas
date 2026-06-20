import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "./_components/chrome";

export const metadata: Metadata = {
  title: "Talko AI — AI conversations for WhatsApp, Instagram & Messenger",
  description:
    "Automate WhatsApp, Instagram, Facebook Messenger and a website web-chat widget with AI replies, broadcasts, chatbot flows, drip sequences and catalog checkout. One inbox for every conversation. Start a free 14-day trial.",
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-600 antialiased">
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
