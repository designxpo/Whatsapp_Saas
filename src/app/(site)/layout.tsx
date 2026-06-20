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
      <a href="#main-content" className="sr-only rounded-xl border border-slate-200 text-sm font-bold text-[#0783fd] focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-2.5 focus:shadow-md focus:outline-none focus:ring-2 focus:ring-[#0783fd] focus:ring-offset-2">
        Skip to main content
      </a>
      <SiteNav />
      <main id="main-content">{children}</main>
      <SiteFooter />
    </div>
  );
}
