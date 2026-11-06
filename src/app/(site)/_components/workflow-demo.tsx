"use client";

import { CharacterStory } from "./character-story";
import type { CharacterStoryId } from "../_content/character-stories";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  FileText,
  GitBranch,
  Instagram,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserRound,
  Clock3,
  CreditCard,
  Star,
  Repeat2,
  BarChart3,
  Megaphone,
  ShoppingBag,
  Users,
  BookOpen,
  Youtube,
  Globe,
  type LucideIcon,
} from "lucide-react";

const EXAMPLES: {
  id: string;
  label: string;
  message: string;
  channel: string;
  nodes: { title: string; detail: string; icon: LucideIcon }[];
  result: string;
  note: string;
}[] = [
  {
    id: "journey",
    label: "The whole journey",
    message:
      "A question. A review. A new enquiry. Give each one a useful next step.",
    channel: "Your customer touchpoints",
    nodes: [
      {
        title: "Listen everywhere",
        detail: "Chats, comments and Google reviews",
        icon: MessageSquare,
      },
      {
        title: "Respond with context",
        detail: "Your knowledge, voice and team",
        icon: Sparkles,
      },
      {
        title: "Keep things moving",
        detail: "Campaigns, sequences and sales",
        icon: Repeat2,
      },
      {
        title: "Learn what works",
        detail: "Activity, outcomes and opportunities",
        icon: BarChart3,
      },
    ],
    result: "One connected customer journey",
    note: "Available automations depend on each connected channel. You choose what runs and what needs approval.",
  },
  {
    id: "reviews",
    label: "Reply to reviews",
    message:
      "A customer shares their experience on your Google Business Profile.",
    channel: "Google Reviews",
    nodes: [
      {
        title: "Review received",
        detail: "Bring the feedback into Talko AI",
        icon: Star,
      },
      {
        title: "Draft a useful reply",
        detail: "Respond to what they actually said",
        icon: Sparkles,
      },
      {
        title: "Apply your rules",
        detail: "Rating threshold + sensitive topics",
        icon: ShieldCheck,
      },
      {
        title: "Reply or review",
        detail: "Automatically send or ask your team",
        icon: CheckCheck,
      },
    ],
    result: "A considered reply for every experience",
    note: "You decide which reviews can be answered automatically and which need approval.",
  },
  {
    id: "sequence",
    label: "Nurture with sequences",
    message:
      "An interested customer needs a little more time and the right information.",
    channel: "Drip sequences",
    nodes: [
      {
        title: "Start with an event",
        detail: "Choose what begins the journey",
        icon: MessageSquare,
      },
      {
        title: "Wait for the moment",
        detail: "Set the delay between steps",
        icon: Clock3,
      },
      {
        title: "Share something useful",
        detail: "Send your approved message",
        icon: FileText,
      },
      {
        title: "Check the next step",
        detail: "Continue or exit the sequence",
        icon: Repeat2,
      },
    ],
    result: "Follow-ups that belong to a journey",
    note: "Message delivery follows each channel’s available features, consent and messaging-window rules.",
  },
  {
    id: "creator",
    label: "Sell a digital guide",
    message: "Someone comments “GUIDE” on your Instagram post.",
    channel: "Instagram comment",
    nodes: [
      {
        title: "Comment received",
        detail: "Match your post + keyword",
        icon: Instagram,
      },
      {
        title: "Choose your flow",
        detail: "Direct DM, check in DM or check before DM",
        icon: GitBranch,
      },
      {
        title: "Share your resource",
        detail: "Your message. Your approved link.",
        icon: FileText,
      },
      {
        title: "Record the outcome",
        detail: "Separate interest from a purchase",
        icon: CreditCard,
      },
    ],
    result: "From a comment to a customer journey",
    note: "Payment-confirmed purchases are recorded when a connected checkout reports them.",
  },
  {
    id: "business",
    label: "Qualify an enquiry",
    message: "“Is your weekend workshop right for a beginner?”",
    channel: "Facebook Messenger",
    nodes: [
      {
        title: "Enquiry received",
        detail: "Match the campaign context",
        icon: MessageSquare,
      },
      {
        title: "Answer with AI",
        detail: "Use your approved offer facts",
        icon: Sparkles,
      },
      {
        title: "Ask what matters",
        detail: "One relevant question at a time",
        icon: UserRound,
      },
      {
        title: "Keep the context",
        detail: "Your team picks up the thread",
        icon: CheckCheck,
      },
    ],
    result: "A useful answer. A better-qualified enquiry.",
    note: "AI replies run on your own provider key, with your team in control.",
  },
  {
    id: "promise",
    label: "Follow through",
    message: "Your team replies: “We’ll send your quotation tomorrow.”",
    channel: "Customer conversation",
    nodes: [
      {
        title: "Spot the promise",
        detail: "Capture a review suggestion",
        icon: MessageSquare,
      },
      {
        title: "Review the evidence",
        detail: "Keep a real sent reply attached",
        icon: ShieldCheck,
      },
      {
        title: "Set owner + deadline",
        detail: "Make the next action clear",
        icon: Clock3,
      },
      {
        title: "Mark it fulfilled",
        detail: "See what is still outstanding",
        icon: CheckCheck,
      },
    ],
    result: "A promise your team can actually track",
    note: "Your team reviews commitments. Customer reminders are never sent automatically.",
  },
  {
    id: "broadcasts",
    label: "Run a campaign",
    message:
      "You have a useful update for customers who asked to hear from you.",
    channel: "Broadcast campaigns",
    nodes: [
      {
        title: "Choose your audience",
        detail: "Select the relevant opted-in segment",
        icon: Users,
      },
      {
        title: "Prepare your message",
        detail: "Use an approved channel template",
        icon: Megaphone,
      },
      {
        title: "Send or schedule",
        detail: "Choose when the campaign runs",
        icon: Clock3,
      },
      {
        title: "Read the response",
        detail: "Track delivery, replies and activity",
        icon: BarChart3,
      },
    ],
    result: "A campaign connected to the conversation",
    note: "WhatsApp campaigns use approved templates and channel-specific consent and delivery rules.",
  },
  {
    id: "commerce",
    label: "Sell in conversation",
    message: "A customer asks about a product and wants to know what to buy.",
    channel: "Catalog, checkout & sales",
    nodes: [
      {
        title: "Understand the need",
        detail: "Keep the enquiry and product context",
        icon: MessageSquare,
      },
      {
        title: "Share the right product",
        detail: "Use your catalog and approved details",
        icon: ShoppingBag,
      },
      {
        title: "Connect the checkout",
        detail: "Offer the available payment flow",
        icon: CreditCard,
      },
      {
        title: "Track the next action",
        detail: "Record the sale or follow-up",
        icon: CheckCheck,
      },
    ],
    result: "Interest, products and checkout in one journey",
    note: "Available catalog and checkout options depend on your channel and connected payment provider.",
  },
  {
    id: "audiences",
    label: "Organise an audience",
    message:
      "Your audience includes new enquiries, workshop interest and returning customers.",
    channel: "Contact groups & team ownership",
    nodes: [
      {
        title: "Capture the contact",
        detail: "Keep the details they shared",
        icon: UserRound,
      },
      {
        title: "Apply the right labels",
        detail: "Organise contacts into segments",
        icon: Users,
      },
      {
        title: "Choose the next action",
        detail: "Target a campaign or assign your team",
        icon: GitBranch,
      },
      {
        title: "Keep the context",
        detail: "See the contact and conversation together",
        icon: MessageSquare,
      },
    ],
    result: "Relevant audiences. Clear team ownership.",
    note: "Audience groups organise contacts inside Talko AI through labels and segments.",
  },
  {
    id: "knowledge",
    label: "Ground your AI",
    message:
      "Your customers need answers that match your actual products, prices and policies.",
    channel: "AI knowledge & business context",
    nodes: [
      {
        title: "Add your knowledge",
        detail: "Bring your documents and business facts",
        icon: BookOpen,
      },
      {
        title: "Match the question",
        detail: "Retrieve relevant business context",
        icon: MessageSquare,
      },
      {
        title: "Draft in your voice",
        detail: "Use your own connected AI provider",
        icon: Sparkles,
      },
      {
        title: "Keep your team involved",
        detail: "Handle the cases that need a person",
        icon: UserRound,
      },
    ],
    result: "Useful answers grounded in your business",
    note: "AI uses your knowledge and provider key. Your team remains responsible for reviewing and maintaining the source facts.",
  },
  {
    id: "youtube",
    label: "Respond on YouTube",
    message: "A viewer leaves a question or comment under your video.",
    channel: "YouTube comment automation",
    nodes: [
      {
        title: "Receive the comment",
        detail: "Match your connected video and rules",
        icon: Youtube,
      },
      {
        title: "Apply your rules",
        detail: "Choose reply or moderation behaviour",
        icon: ShieldCheck,
      },
      {
        title: "Prepare a useful answer",
        detail: "Use the context and your AI knowledge",
        icon: Sparkles,
      },
      {
        title: "Continue the thread",
        detail: "Respond within the available channel flow",
        icon: MessageSquare,
      },
    ],
    result: "A useful response where your audience is watching",
    note: "Comment replies and moderation follow your settings and YouTube’s available API features and limits.",
  },
  {
    id: "webchat",
    label: "Welcome a site visitor",
    message: "A visitor has a question while browsing your website.",
    channel: "Website chat",
    nodes: [
      {
        title: "Start on your site",
        detail: "The visitor opens your chat widget",
        icon: Globe,
      },
      {
        title: "Answer the question",
        detail: "Use your business knowledge",
        icon: Sparkles,
      },
      {
        title: "Capture what matters",
        detail: "Ask for relevant details in the flow",
        icon: UserRound,
      },
      {
        title: "Route the conversation",
        detail: "Keep the enquiry in your shared inbox",
        icon: GitBranch,
      },
    ],
    result: "Website questions become connected conversations",
    note: "The widget uses the channel and AI settings you configure for your business.",
  },
  {
    id: "handoff",
    label: "Continue on WhatsApp",
    message:
      "Someone on Instagram chooses to continue a conversation on WhatsApp.",
    channel: "Explicit cross-channel handoff",
    nodes: [
      {
        title: "Offer the handoff",
        detail: "Share a link with their personal code",
        icon: Instagram,
      },
      {
        title: "Let the customer start",
        detail: "They open WhatsApp and send the code",
        icon: MessageSquare,
      },
      {
        title: "Match the shared code",
        detail: "Link the confirmed journey context",
        icon: ShieldCheck,
      },
      {
        title: "Continue with context",
        detail: "Your team picks up the existing enquiry",
        icon: CheckCheck,
      },
    ],
    result: "A new channel without starting the story over",
    note: "The customer initiates the handoff. Talko AI does not guess identities across channels.",
  },
  {
    id: "experiments",
    label: "Compare outcomes",
    message:
      "You want to learn which Instagram journey leads to more useful outcomes.",
    channel: "Outcome experiments",
    nodes: [
      {
        title: "Choose two journeys",
        detail: "Define the variants you want to compare",
        icon: GitBranch,
      },
      {
        title: "Keep groups stable",
        detail: "Assign the contact consistently",
        icon: Users,
      },
      {
        title: "Record actual outcomes",
        detail: "Capture a lead, booking or purchase",
        icon: CheckCheck,
      },
      {
        title: "Compare the evidence",
        detail: "Review recorded outcomes by variant",
        icon: BarChart3,
      },
    ],
    result: "A clearer decision from observed outcomes",
    note: "Manually recorded outcomes and payment-confirmed purchases remain separate. No uplift is assumed.",
  },
];

const STORY_FOR_WORKFLOW: Record<string, CharacterStoryId> = { journey: "team", reviews: "reviews", sequence: "followthrough", creator: "creator", business: "booking", promise: "followthrough", broadcasts: "insights", commerce: "commerce", audiences: "agency", knowledge: "knowledge", youtube: "creator", webchat: "team", handoff: "handoff", experiments: "insights" };

const STEP_SECONDS = 2; // matches the 2s per-step delay in marketing.css
const RESUME_AFTER_MS = 5000;

export function WorkflowDemo() {
  const [selected, setSelected] = useState(EXAMPLES[0].id);
  const [inspecting, setInspecting] = useState<number | null>(null);
  // After a step is inspected, the walkthrough carries on from that step.
  const [resumeFrom, setResumeFrom] = useState(0);
  const [cycle, setCycle] = useState(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const example = EXAMPLES.find((item) => item.id === selected)!;
  const clearResume = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  };
  useEffect(() => clearResume, []);
  const resume = (index: number) => {
    clearResume();
    setInspecting(null);
    setResumeFrom(index);
    setCycle((value) => value + 1);
  };
  const inspect = (index: number) => {
    if (inspecting === index) return resume(index);
    clearResume();
    setInspecting(index);
    resumeTimer.current = setTimeout(() => resume(index), RESUME_AFTER_MS);
  };
  const choose = (id: string) => {
    clearResume();
    setSelected(id);
    setInspecting(null);
    setResumeFrom(0);
  };
  return (
    <div className="workflow-demo" id="how-it-works" data-motion-region>
      <div className="workflow-demo-toolbar">
        <span>
          <span className="workflow-status-dot" /> YOUR NEXT CONVERSATION
        </span>
        <span>ILLUSTRATIVE WORKFLOW</span>
      </div>
      <div
        role="group"
        aria-label="Explore an example workflow"
        className="workflow-demo-tabs"
      >
        {EXAMPLES.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === item.id}
            onClick={() => choose(item.id)}
          >
            {item.label}
            <ArrowRight size={13} aria-hidden />
          </button>
        ))}
      </div>
      <div className="workflow-picker">
        <label htmlFor="workflow-feature">
          Explore all {EXAMPLES.length} workflows
        </label>
        <select
          id="workflow-feature"
          value={selected}
          onChange={(event) => choose(event.target.value)}
        >
          {EXAMPLES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div
        key={example.id}
        className="workflow-demo-canvas"
        data-inspecting={inspecting !== null}
        style={{ "--cycle-shift": `${resumeFrom * STEP_SECONDS}s` } as CSSProperties}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="workflow-story-layout">
        <CharacterStory scene={STORY_FOR_WORKFLOW[example.id] ?? "team"} compact priority={example.id === "journey"} />
        <div className="workflow-message">
          <span className="workflow-message-icon">
            <MessageSquare size={19} aria-hidden />
          </span>
          <div>
            <span className="workflow-kicker">{example.channel}</span>
            <p>{example.message}</p>
          </div>
          <span className="workflow-message-tag">Trigger</span>
        </div>
        </div>
        <ol key={`nodes-${cycle}`} className="workflow-nodes" aria-label="Workflow steps">
          {example.nodes.map((node, index) => (
            <li
              key={node.title}
              style={{ "--step-index": index } as CSSProperties}
            >
              <button
                type="button"
                aria-label={`Inspect step ${index + 1}: ${node.title}`}
                aria-pressed={inspecting === index}
                onClick={() => inspect(index)}
                className={`workflow-node ${index === 1 ? "workflow-node-ai" : ""}`}
              >
                <span className="workflow-step-number" aria-hidden>
                  {index + 1}
                </span>
                <span className="workflow-node-icon">
                  <node.icon size={23} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="workflow-node-port" aria-hidden />
              </button>
              <span className="workflow-link" aria-hidden>
                <span />
              </span>
              <h3>{node.title}</h3>
              <p>{node.detail}</p>
            </li>
          ))}
        </ol>
        <div key={`outcome-${cycle}`} className="workflow-outcome">
          <span>
            <Check size={16} aria-hidden />
            {example.result}
          </span>
          <span className="workflow-kicker">YOUR RULES. CONNECTED.</span>
        </div>
        <div className="workflow-step-insight">
          {inspecting === null ? (
            "Follow the signals. Select a step to inspect it."
          ) : (
            <>
              <strong>
                Step {inspecting + 1}: {example.nodes[inspecting].title}
              </strong>
              <span>
                {example.nodes[inspecting].detail}. The walkthrough carries on
                from here in a moment.
              </span>
            </>
          )}
        </div>
      </div>
      <p className="workflow-demo-note">{example.note}</p>
    </div>
  );
}
