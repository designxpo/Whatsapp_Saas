import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Instagram,
  MessageSquare,
  Sparkles,
  UserRound,
  GitBranch,
  Star,
  Repeat2,
  Users,
  ShoppingBag,
  BrainCircuit,
} from "lucide-react";
import { InfiniteCardRails } from "./feature-carousel";
import { Button } from "./ui";

export function GrowthSpotlight() {
  return (
    <section
      className="marketing-growth marketing-container"
      id="social-growth"
      aria-labelledby="growth-heading"
    >
      <div className="marketing-section-heading">
        <p className="marketing-eyebrow">MEET SOCIAL GROWTH</p>
        <h2 id="growth-heading">
          A reply is only
          <br />
          the beginning.
        </h2>
        <p>Connect the campaign, the conversation and what happens next.</p>
      </div>
      <div className="marketing-growth-grid">
        <article data-tilt className="growth-card growth-card-wide">
          <div className="growth-card-copy">
            <span className="marketing-kicker">
              01 / CAMPAIGN-AWARE CONVERSATIONS
            </span>
            <h3>
              The right context.
              <br />
              From the first question.
            </h3>
            <p>
              Give AI the approved facts behind each post or offer. Qualify
              interest without starting over.
            </p>
          </div>
          <div
            className="campaign-visual"
            aria-label="Illustration of approved campaign facts guiding a reply"
          >
            <div className="campaign-source">
              <FileText size={19} aria-hidden />
              <div>
                <b>Your workshop</b>
                <span>Approved facts + questions</span>
              </div>
              <Check size={15} aria-hidden />
            </div>
            <div className="campaign-connector" aria-hidden />
            <div className="campaign-answer">
              <span>
                <Sparkles size={15} aria-hidden /> TALKO AI
              </span>
              <p>“What would you like to learn?”</p>
              <div>
                <span>In context</span>
                <span>In your voice</span>
              </div>
            </div>
          </div>
        </article>
        <article data-tilt className="growth-card growth-card-promise">
          <span className="marketing-kicker">02 / PROMISE TRACKING</span>
          <h3>
            “We’ll get back to you.”
            <br />
            Now has an owner.
          </h3>
          <p>Review promises, assign a deadline and track fulfilment.</p>
          <div className="promise-visual">
            <div>
              <Clock3 size={17} aria-hidden />
              <span>Send the quotation</span>
            </div>
            <div>
              <span>
                <UserRound size={13} aria-hidden /> Assigned to your team
              </span>
              <span className="promise-review">For review</span>
            </div>
            <p>Evidence → owner → due date → fulfilled</p>
          </div>
        </article>
        <article data-tilt className="growth-card">
          <span className="marketing-kicker">03 / AUDIENCE DEMAND</span>
          <h3>
            They ask.
            <br />
            You find the opportunity.
          </h3>
          <p>
            Turn repeated unanswered questions into approved knowledge and
            campaign briefs.
          </p>
          <div
            className="demand-visual"
            aria-label="Illustrative questions becoming a campaign brief"
          >
            <span>“Do you run weekend sessions?”</span>
            <span>“Is there a beginner’s guide?”</span>
            <div>
              <ArrowRight size={15} aria-hidden /> Your next content brief
            </div>
          </div>
        </article>
        <article data-tilt className="growth-card">
          <span className="marketing-kicker">04 / OUTCOME EXPERIMENTS</span>
          <h3>
            Test the journey.
            <br />
            Measure the outcome.
          </h3>
          <p>
            Compare Instagram delivery options against recorded leads, bookings
            or purchases.
          </p>
          <div className="experiment-visual">
            <div>
              <b>A</b>
              <span>Send the resource</span>
            </div>
            <div>
              <b>B</b>
              <span>Verify a follow in DM</span>
            </div>
            <span>
              <GitBranch size={14} aria-hidden /> Stable groups. Recorded
              outcomes.
            </span>
          </div>
        </article>
        <article data-tilt className="growth-card">
          <span className="marketing-kicker">05 / CONNECTED JOURNEYS</span>
          <h3>
            New channel.
            <br />
            Same conversation.
          </h3>
          <p>
            Carry context to WhatsApp when someone starts a chat using their
            personal handoff code.
          </p>
          <div className="journey-visual">
            <span>
              <Instagram size={22} aria-hidden /> Instagram
            </span>
            <ArrowRight size={17} aria-hidden />
            <span>
              <MessageSquare size={22} aria-hidden /> WhatsApp
            </span>
          </div>
          <p className="growth-card-footnote">
            Explicit handoff. No guessed identities.
          </p>
        </article>
      </div>
      <p className="marketing-caption">
        Illustrative product views. Instagram follow requirements are optional:
        verify in DM or before DM. Follow checks depend on Meta’s available
        profile access; a first-time commenter may need to interact in DM.
        Payment-confirmed and manually recorded outcomes are shown separately.
      </p>
    </section>
  );
}

export function CreatorStory() {
  return (
    <section
      className="marketing-container marketing-creator"
      id="for-creators"
      aria-labelledby="creator-heading"
    >
      <div className="creator-story-copy">
        <p className="marketing-eyebrow">FOR CREATORS, COACHES & EDUCATORS</p>
        <h2 id="creator-heading">
          You make the content.
          <br />
          <span>Keep the opportunity.</span>
        </h2>
        <p>
          Make room for the conversations that can grow your business. Bring
          your offers, your voice and your audience. Keep the next action in
          sight.
        </p>
        <ul>
          <li>
            <Check size={16} aria-hidden /> Share guides and digital resources
          </li>
          <li>
            <Check size={16} aria-hidden /> Qualify workshop and coaching
            enquiries
          </li>
          <li>
            <Check size={16} aria-hidden /> Follow up on brand partnership
            promises
          </li>
          <li>
            <Check size={16} aria-hidden /> Learn from real questions and
            purchases
          </li>
        </ul>
        <Button href="/pricing">
          Explore creator plans <ArrowUpRight size={16} aria-hidden />
        </Button>
      </div>
      <div
        data-tilt
        className="creator-loop"
        aria-label="Illustrative creator growth loop"
      >
        <span className="marketing-kicker">YOUR CONTENT, WITH A NEXT STEP</span>
        <div className="creator-content-tile">
          <span>
            <Instagram size={20} aria-hidden /> Your next post
          </span>
          <div>
            <span>THE</span>
            <span>BEGINNER’S</span>
            <span>
              GUIDE
              <span className="creator-star" aria-hidden>
                ✳
              </span>
            </span>
          </div>
          <p>Useful content starts a useful conversation.</p>
        </div>
        <div className="creator-loop-steps">
          <span>
            <MessageSquare size={15} aria-hidden /> Enquiry
          </span>
          <ArrowRight size={13} aria-hidden />
          <span>
            <FileText size={15} aria-hidden /> Your offer
          </span>
          <ArrowRight size={13} aria-hidden />
          <span>
            <CheckCheck size={15} aria-hidden /> Outcome
          </span>
        </div>
        <p>Use what you learn to decide what comes next.</p>
      </div>
    </section>
  );
}

export function NextStepBand() {
  return (
    <section className="marketing-container marketing-next-step">
      <div>
        <p className="marketing-eyebrow">START WITH ONE CONVERSATION</p>
        <h2>
          A better next step
          <br />
          for every enquiry.
        </h2>
        <p>
          Connect your channels. Add your knowledge.
          <br />
          Build the journey your audience deserves.
        </p>
        <div>
          <Button href="/signup">
            Start free trial <ArrowRight size={16} aria-hidden />
          </Button>
          <Link href="/contact" className="marketing-text-link">
            Talk to our team <ArrowUpRight size={15} aria-hidden />
          </Link>
        </div>
        <span>14 days to explore. No credit card required.</span>
      </div>
      <div className="next-step-signal" aria-hidden data-motion-region>
        <div className="signal-orbit">
          <i />
        </div>
        <div className="signal-node">
          <MessageSquare />
        </div>
        <span className="signal-wire">
          <i />
        </span>
        <div className="signal-node signal-node-ai">
          <Sparkles />
        </div>
        <span className="signal-wire signal-wire-out">
          <i />
        </span>
        <div className="signal-node signal-node-done">
          <CheckCheck />
        </div>
        <span className="signal-caption">MESSAGE → INTELLIGENCE → ACTION</span>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: "Conversations",
    text: "Answer, qualify and hand over with context.",
    tags: ["Unified inbox", "AI replies", "Chatbot flows"],
  },
  {
    icon: Star,
    title: "Reputation",
    text: "Give every Google review a thoughtful reply.",
    tags: ["Google Reviews", "Approval rules", "AI drafts"],
  },
  {
    icon: Repeat2,
    title: "Campaigns & follow-ups",
    text: "Stay useful beyond the first interaction.",
    tags: ["Broadcasts", "Drip sequences", "Event triggers"],
  },
  {
    icon: Users,
    title: "Audiences & teams",
    text: "Organise the people. Coordinate the next step.",
    tags: ["Audience groups", "Labels & segments", "Team assignment"],
  },
  {
    icon: ShoppingBag,
    title: "Sales & commerce",
    text: "Connect interest to the next purchase.",
    tags: ["Sales pipeline", "Catalog & checkout", "Cart recovery"],
  },
  {
    icon: BrainCircuit,
    title: "Intelligence & growth",
    text: "Learn what customers need. Act on it.",
    tags: ["AI knowledge", "Analytics", "Creator workflows"],
  },
];

export function PlatformCapabilities() {
  return (
    <section
      className="marketing-container marketing-capabilities"
      aria-labelledby="capabilities-heading"
    >
      <div className="marketing-section-heading">
        <p className="marketing-eyebrow">THE WHOLE CUSTOMER JOURNEY</p>
        <h2 id="capabilities-heading">
          More than a reply.
          <br />
          Everything that comes next.
        </h2>
        <p>
          Bring your conversations, reputation, audience and revenue into one
          connected workspace.
        </p>
      </div>
      <InfiniteCardRails
        className="capability-carousel"
        label="Explore the whole customer journey"
        rows={[CAPABILITIES.slice(0, 3), CAPABILITIES.slice(3)].map(
          (row, rowIndex) =>
            row.map((item, index) => (
              <article className="capability-card" key={item.title} data-tilt>
                <div>
                  <span className="capability-icon">
                    <item.icon size={23} strokeWidth={1.6} aria-hidden />
                  </span>
                  <span className="marketing-kicker">
                    0{rowIndex * 3 + index + 1}
                  </span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <ul>
                  {item.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </article>
            )),
        )}
      />
      <Link href="/features" className="capability-explore">
        Explore the full platform <ArrowUpRight size={16} aria-hidden />
      </Link>
    </section>
  );
}
