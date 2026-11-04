"use client";

// Interactive product tour — real Talko AI screenshots (public/tour) in a
// browser frame, with a feature highlight beside each. Buttons switch the screen;
// all screenshots stay mounted (opacity toggle) so switching is instant.
import { useState, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  MessageSquare,
  Workflow,
  Megaphone,
  BarChart3,
  LayoutGrid,
  Sparkles,
  Plug,
  ShoppingBag,
  Check,
  ArrowRight,
  Star,
  Repeat2,
  Users,
  type LucideIcon,
} from "lucide-react";

type Screen = {
  key: string;
  label: string;
  icon: LucideIcon;
  title: string;
  blurb: string;
  points: string[];
  src?: string;
  preview?: "reviews" | "sequences" | "audiences";
};

const SCREENS: Screen[] = [
  {
    key: "reviews",
    label: "Google Reviews",
    icon: Star,
    preview: "reviews",
    title: "Your reputation, thoughtfully managed",
    blurb:
      "Manage Google Business Profile reviews alongside your customer conversations, with AI drafts and the approval rules you choose.",
    points: [
      "Replies grounded in the actual review",
      "Set the rating threshold for automatic replies",
      "Sensitive topics wait for your approval",
    ],
  },
  {
    key: "sequences",
    label: "Drip Sequences",
    icon: Repeat2,
    preview: "sequences",
    title: "The right next step, at the right time",
    blurb:
      "Build a follow-up journey from a trigger, a wait and a useful message. Keep track of enrolments and outcomes in one place.",
    points: [
      "Event-triggered and scheduled follow-ups",
      "Steps, delays and exit conditions",
      "Track sequence activity and performance",
    ],
  },
  {
    key: "audiences",
    label: "Audience Groups",
    icon: Users,
    preview: "audiences",
    title: "A more useful view of your audience",
    blurb:
      "Use contact labels, segments and team ownership to give each conversation the right context and next action.",
    points: [
      "Group contacts with labels and segments",
      "Target campaigns to the relevant audience",
      "Assign conversations to your team",
    ],
  },
  {
    key: "inbox",
    label: "Unified Inbox",
    icon: MessageSquare,
    src: "/tour/inbox.png",
    title: "One AI inbox for every channel",
    blurb:
      "WhatsApp, Instagram, Messenger, YouTube comments and web chat land in a single live inbox. The AI answers instantly from your knowledge base — and your team takes over in one click.",
    points: [
      "Replies that quote your own docs, prices & policies",
      "Labels, assignment, AI personas & lead capture",
      "Filter by channel, ‘needs reply’ or escalations",
    ],
  },
  {
    key: "flows",
    label: "Chatbot Flows",
    icon: Workflow,
    src: "/tour/flows.png",
    title: "No-code chatbot flows",
    blurb:
      "Drag-and-drop flows that greet, qualify, book and route — and anything off-script falls through to the AI, so it’s never a dead end.",
    points: [
      "Buttons, forms, conditions & business hours",
      "Triggered by a keyword or straight from a Meta ad",
      "Runs on WhatsApp, Instagram, Messenger or web",
    ],
  },
  {
    key: "broadcast",
    label: "Broadcasts",
    icon: Megaphone,
    src: "/tour/broadcast.png",
    title: "Broadcasts with a full delivery funnel",
    blurb:
      "Send approved templates to thousands and watch every step — sent, delivered, read, clicked, replied — with click tracking built in.",
    points: [
      "Schedule sends or target by tag & segment",
      "Per-day audience chart & click attribution",
      "Opt-in respected, quality auto-protected",
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    icon: BarChart3,
    src: "/tour/analytics.png",
    title: "Cross-channel analytics, summarized by AI",
    blurb:
      "Messaging performance across every channel — plus a one-tap AI brief on what’s working, what isn’t, and the highest-impact next step.",
    points: [
      "Read & delivery rates, escalations, KB coverage",
      "AI executive brief in a click",
      "14-day trends across every channel",
    ],
  },
  {
    key: "pipeline",
    label: "Sales Pipeline",
    icon: LayoutGrid,
    src: "/tour/pipeline.png",
    title: "A sales pipeline built into chat",
    blurb:
      "Every card is a contact with their latest message. Drag leads across stages — moving a card can auto-tag, start a sequence and push to your CRM.",
    points: [
      "Drag-and-drop kanban board",
      "Stage automations & drip enrolment",
      "Sync contacts & activity to LeadSquared, HubSpot & Pipedrive",
    ],
  },
  {
    key: "aihub",
    label: "AI Hub",
    icon: Sparkles,
    src: "/tour/aihub.png",
    title: "Your AI key — no per-message markup",
    blurb:
      "Bring your own Gemini, OpenAI or Anthropic key — usage is billed to you, so costs stay predictable. Build role-based agents that auto-route per question.",
    points: [
      "Bring-your-own AI key, keep your margins",
      "Multiple personas, auto-routed by topic",
      "Lead-capture functions & on-brand rewrites",
    ],
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    src: "/tour/integrations.png",
    title: "Connect your CRM, payments & store — no code",
    blurb:
      "Sync leads, take payments and import catalogs in a few clicks — then pipe every event into the tools your team already lives in.",
    points: [
      "HubSpot, Pipedrive, LeadSquared, Shopify, WooCommerce",
      "Razorpay & Stripe pay links in chat",
      "Zapier / Make / n8n, Slack, Teams & Cal.com",
    ],
  },
  {
    key: "catalog",
    label: "Catalog",
    icon: ShoppingBag,
    src: "/tour/catalog.png",
    title: "Sell right inside the chat",
    blurb:
      "Show products, build carts and recover them — with in-chat checkout — so a conversation becomes a sale without leaving the thread.",
    points: [
      "Product cards with images, prices & buttons",
      "In-chat checkout flow",
      "Automated abandoned-cart recovery",
    ],
  },
];

export function ProductTour() {
  const [active, setActive] = useState<Screen>(
    SCREENS.find((screen) => screen.key === "inbox")!,
  );

  return (
    <div className="marketing-tour">
      <div className="tour-controls" role="group" aria-label="Product screens">
        {SCREENS.map((screen, index) => (
          <button
            key={screen.key}
            type="button"
            aria-pressed={screen.key === active.key}
            onClick={() => setActive(screen)}
          >
            <screen.icon size={17} strokeWidth={1.6} aria-hidden />
            <span>{screen.label}</span>
            <span className="tour-control-number">
              {String(index + 1).padStart(2, "0")}
            </span>
          </button>
        ))}
      </div>
      <div className="tour-stage">
        <div className="tour-preview">
          <div className="tour-preview-bar">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>Talko AI / {active.label}</span>
            <span>{active.preview ? "WORKFLOW EXAMPLE" : "PRODUCT VIEW"}</span>
          </div>
          {active.preview ? (
            <CapabilityPreview kind={active.preview} />
          ) : (
            <div className="tour-screen">
              {SCREENS.filter((screen) => screen.src).map((screen) => (
                <Image
                  key={screen.key}
                  src={screen.src!}
                  alt={screen.title}
                  fill
                  sizes="(min-width: 1024px) 900px, 100vw"
                  className={`object-contain ${screen.key === active.key ? "opacity-100" : "pointer-events-none opacity-0"}`}
                />
              ))}
            </div>
          )}
        </div>
        <div className="tour-copy">
          <div>
            <p className="marketing-eyebrow">CONNECTED BY DESIGN</p>
            <h3>{active.title}</h3>
            <p>{active.blurb}</p>
            <Link href="/signup">
              Start your free trial <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
          <ul>
            {active.points.map((point) => (
              <li key={point}>
                <Check size={15} aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CapabilityPreview({
  kind,
}: {
  kind: "reviews" | "sequences" | "audiences";
}) {
  if (kind === "reviews")
    return (
      <div className="tour-example tour-review">
        <div className="tour-example-heading">
          <Star size={20} aria-hidden />
          <span>Google Reviews</span>
          <span>Your rules. Your voice.</span>
        </div>
        <div className="review-example-card">
          <span className="review-example-stars" aria-label="5 stars">
            ★★★★★
          </span>
          <h4>“Such a helpful team. They made everything easy.”</h4>
          <p>Sample review · illustrative content</p>
          <div className="review-example-draft">
            <span>
              <Sparkles size={14} aria-hidden /> AI DRAFT
            </span>
            <p>
              Thank you for the lovely feedback! We’re glad the team could make
              things easier for you.
            </p>
            <span className="review-example-status">
              <Check size={13} aria-hidden /> Review against your approval rules
            </span>
          </div>
        </div>
      </div>
    );
  if (kind === "sequences")
    return (
      <div className="tour-example tour-sequence">
        <div className="tour-example-heading">
          <Repeat2 size={20} aria-hidden />
          <span>Your follow-up journey</span>
        </div>
        <ol>
          {[
            ["01", "A new enquiry arrives", "Start from the event you choose"],
            ["02", "Wait for the right moment", "Set the delay between steps"],
            ["03", "Send something useful", "Share your approved message"],
            ["04", "Check the next action", "Continue or exit the journey"],
          ].map(([number, title, text], index) => (
            <li key={number} style={{ "--step-index": index } as CSSProperties}>
              <span>{number}</span>
              <div>
                <h4>{title}</h4>
                <p>{text}</p>
              </div>
              <Check size={15} aria-hidden />
            </li>
          ))}
        </ol>
        <p className="tour-example-note">
          Illustrative sequence. Delivery depends on the channel’s messaging
          rules and the customer’s consent.
        </p>
      </div>
    );
  return (
    <div className="tour-example tour-audiences">
      <div className="tour-example-heading">
        <Users size={20} aria-hidden />
        <span>Make every audience relevant</span>
      </div>
      <div className="audience-example-groups">
        {[
          ["New enquiries", "Give first-time questions a useful answer"],
          ["Workshop interest", "Send the details they asked for"],
          ["Returning customers", "Keep the relationship moving"],
        ].map(([title, text]) => (
          <div key={title}>
            <Users size={23} aria-hidden />
            <h4>{title}</h4>
            <p>{text}</p>
            <span>Label → segment → next action</span>
          </div>
        ))}
      </div>
      <p className="tour-example-note">
        Illustrative contact segments. Audience groups organise contacts inside
        Talko AI.
      </p>
    </div>
  );
}
