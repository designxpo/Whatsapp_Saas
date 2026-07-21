"use client";

// Interactive product tour — real Talko AI screenshots (public/tour) in a
// browser frame, with a feature highlight beside each. Buttons switch the screen;
// all screenshots stay mounted (opacity toggle) so switching is instant.
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Parallax } from "./motion";
import {
  MessageSquare, Workflow, Megaphone, BarChart3, LayoutGrid, Sparkles, Plug, ShoppingBag,
  Check, ArrowRight, type LucideIcon,
} from "lucide-react";

type Screen = { key: string; label: string; icon: LucideIcon; title: string; blurb: string; points: string[]; src: string };

const SCREENS: Screen[] = [
  {
    key: "inbox", label: "Unified Inbox", icon: MessageSquare, src: "/tour/inbox.png",
    title: "One AI inbox for every channel",
    blurb: "WhatsApp, Instagram, Messenger and web chat land in a single live inbox. The AI answers instantly from your knowledge base — and your team takes over in one click.",
    points: ["Replies that quote your own docs, prices & policies", "Labels, assignment, AI personas & lead capture", "Filter by channel, ‘needs reply’ or escalations"],
  },
  {
    key: "flows", label: "Chatbot Flows", icon: Workflow, src: "/tour/flows.png",
    title: "No-code chatbot flows",
    blurb: "Drag-and-drop flows that greet, qualify, book and route — and anything off-script falls through to the AI, so it’s never a dead end.",
    points: ["Buttons, forms, conditions & business hours", "Triggered by a keyword or straight from a Meta ad", "Runs on WhatsApp, Instagram, Messenger or web"],
  },
  {
    key: "broadcast", label: "Broadcasts", icon: Megaphone, src: "/tour/broadcast.png",
    title: "Broadcasts with a full delivery funnel",
    blurb: "Send approved templates to thousands and watch every step — sent, delivered, read, clicked, replied — with click tracking built in.",
    points: ["Schedule sends or target by tag & segment", "Per-day audience chart & click attribution", "Opt-in respected, quality auto-protected"],
  },
  {
    key: "analytics", label: "Analytics", icon: BarChart3, src: "/tour/analytics.png",
    title: "Cross-channel analytics, summarized by AI",
    blurb: "Messaging performance across every channel — plus a one-tap AI brief on what’s working, what isn’t, and the highest-impact next step.",
    points: ["Read & delivery rates, escalations, KB coverage", "AI executive brief in a click", "14-day trends across every channel"],
  },
  {
    key: "pipeline", label: "Sales Pipeline", icon: LayoutGrid, src: "/tour/pipeline.png",
    title: "A sales pipeline built into chat",
    blurb: "Every card is a contact with their latest message. Drag leads across stages — moving a card can auto-tag, start a sequence and push to your CRM.",
    points: ["Drag-and-drop kanban board", "Stage automations & drip enrolment", "Sync contacts & activity to LeadSquared, HubSpot & Pipedrive"],
  },
  {
    key: "aihub", label: "AI Hub", icon: Sparkles, src: "/tour/aihub.png",
    title: "Your AI key — no per-message markup",
    blurb: "Bring your own Gemini, OpenAI or Anthropic key — usage is billed to you, so costs stay predictable. Build role-based agents that auto-route per question.",
    points: ["Bring-your-own AI key, keep your margins", "Multiple personas, auto-routed by topic", "Lead-capture functions & on-brand rewrites"],
  },
  {
    key: "integrations", label: "Integrations", icon: Plug, src: "/tour/integrations.png",
    title: "Connect your CRM, payments & store — no code",
    blurb: "Sync leads, take payments and import catalogs in a few clicks — then pipe every event into the tools your team already lives in.",
    points: ["HubSpot, Pipedrive, LeadSquared, Shopify, WooCommerce", "Razorpay & Stripe pay links in chat", "Zapier / Make / n8n, Slack, Teams & Cal.com"],
  },
  {
    key: "catalog", label: "Catalog", icon: ShoppingBag, src: "/tour/catalog.png",
    title: "Sell right inside the chat",
    blurb: "Show products, build carts and recover them — with in-chat checkout — so a conversation becomes a sale without leaving the thread.",
    points: ["Product cards with images, prices & buttons", "In-chat checkout flow", "Automated abandoned-cart recovery"],
  },
];

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0783fd] focus-visible:ring-offset-2";

export function ProductTour() {
  const [active, setActive] = useState<Screen>(SCREENS[0]);

  return (
    <div>
      {/* Screen switcher — honest toggle buttons (aria-pressed), not a half ARIA tab widget */}
      <div role="group" aria-label="Product screens" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
        {SCREENS.map(s => {
          const on = s.key === active.key;
          return (
            <button key={s.key} type="button" aria-pressed={on} onClick={() => setActive(s)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] transition-colors ${ring} ${on ? "border-[#0783fd] bg-[#0783fd] font-bold text-white shadow-[0_6px_16px_-8px_rgba(7,131,253,0.6)]" : "border-slate-200 bg-white font-semibold text-slate-500 hover:border-[#0783fd]/40 hover:text-[#0783fd]"}`}>
              <s.icon className="h-4 w-4" /> {s.label}
            </button>
          );
        })}
      </div>

      {/* Highlight + browser-framed screenshot */}
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_1.5fr] lg:gap-10">
        <div className="order-2 lg:order-1 lg:pt-2">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><active.icon className="h-5 w-5" /></div>
          <h3 className="mt-4 text-balance text-xl font-extrabold tracking-tight text-slate-900 lg:text-2xl">{active.title}</h3>
          <p className="mt-3 leading-relaxed text-slate-600">{active.blurb}</p>
          <ul className="mt-5 space-y-2.5">
            {active.points.map(p => (
              <li key={p} className="flex gap-2.5 text-sm text-slate-600">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0783fd]/10 text-[#0783fd]"><Check className="h-3 w-3" /></span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <Link href="/signup" className={`mt-7 inline-flex items-center gap-1.5 rounded-sm text-sm font-bold text-[#0783fd] hover:underline ${ring}`}>
            Start your free trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Browser frame — all screenshots stacked, only the active one shown (instant switch) */}
        <Parallax speed={28} className="order-1 lg:order-2">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-24px_rgba(7,131,253,0.22),0_8px_24px_-12px_rgba(0,0,0,0.10)]">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <span className="flex gap-1.5">{["#f87171", "#fbbf24", "#34d399"].map(c => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}</span>
              <span className="mx-auto max-w-[60%] truncate rounded-md border border-slate-200 bg-white px-3 py-1 text-center text-[11px] font-medium text-slate-400">app.talko.ai / {active.key === "inbox" ? "live-chat" : active.key}</span>
            </div>
            <div className="relative aspect-[1600/910] w-full bg-white">
              {SCREENS.map((s, i) => (
                // next/image → auto AVIF/WebP + responsive widths; first screen is
                // the LCP candidate so it gets priority (preload, no lazy).
                <Image key={s.key} src={s.src} alt={s.title} fill priority={i === 0}
                  sizes="(min-width: 1024px) 700px, 100vw"
                  className={`object-contain transition-opacity duration-300 ${s.key === active.key ? "opacity-100" : "pointer-events-none opacity-0"}`} />
              ))}
            </div>
          </div>
        </Parallax>
      </div>
    </div>
  );
}
