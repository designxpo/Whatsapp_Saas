"use client";

import { useState } from "react";
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
];

export function WorkflowDemo() {
  const [selected, setSelected] = useState(EXAMPLES[0].id);
  const example = EXAMPLES.find((e) => e.id === selected)!;
  return (
    <div className="workflow-demo" id="how-it-works">
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
        {EXAMPLES.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={selected === e.id}
            onClick={() => setSelected(e.id)}
          >
            {e.label}
            <ArrowRight size={13} aria-hidden />
          </button>
        ))}
      </div>
      <div
        className="workflow-demo-canvas"
        aria-live="polite"
        aria-atomic="true"
      >
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
        <ol className="workflow-nodes" aria-label="Workflow steps">
          {example.nodes.map((node, i) => (
            <li key={example.id + node.title}>
              <div
                className={`workflow-node ${i === 1 ? "workflow-node-ai" : ""}`}
              >
                <span className="workflow-node-icon">
                  <node.icon size={23} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="workflow-node-port" aria-hidden />
              </div>
              <h3>{node.title}</h3>
              <p>{node.detail}</p>
            </li>
          ))}
        </ol>
        <div className="workflow-outcome">
          <span>
            <Check size={16} aria-hidden /> {example.result}
          </span>
          <span className="workflow-kicker">YOUR RULES. CONNECTED.</span>
        </div>
      </div>
      <p className="workflow-demo-note">{example.note}</p>
    </div>
  );
}
