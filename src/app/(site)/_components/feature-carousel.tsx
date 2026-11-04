import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  AtSign,
  Bot,
  Globe,
  Inbox,
  Instagram,
  Megaphone,
  MessagesSquare,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Workflow,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  megaphone: Megaphone,
  workflow: Workflow,
  repeat: Repeat,
  shopping: ShoppingBag,
  instagram: Instagram,
  inbox: Inbox,
  shield: ShieldCheck,
  messenger: MessagesSquare,
  webchat: Globe,
  comment: AtSign,
  star: Star,
  sparkles: Sparkles,
  youtube: Youtube,
};

function FeatureCard({ item, index }: { item: Feature; index: number }) {
  const Icon = ICONS[item.icon] ?? Bot;
  return (
    <article
      className="feature-loop-card"
      data-tilt
      style={{ "--card-tilt": `${index % 2 ? 1.5 : -1.5}deg` } as CSSProperties}
    >
      <div>
        <span className="site-icon-chip">
          <Icon size={23} strokeWidth={1.7} aria-hidden />
        </span>
        <span className="feature-card-number">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
      <span className="feature-card-spark" aria-hidden>
        <ArrowRight size={15} />
      </span>
    </article>
  );
}

export function FeatureCarousel({ items }: { items: Feature[] }) {
  const split = Math.ceil(items.length / 2);
  return (
    <InfiniteCardRails
      label="Explore automation features"
      rows={[items.slice(0, split), items.slice(split)]
        .filter((row) => row.length)
        .map((row, rowIndex) =>
          row.map((item, index) => (
            <FeatureCard
              key={item.title}
              item={item}
              index={rowIndex * split + index}
            />
          )),
        )}
    />
  );
}

export function InfiniteCardRails({
  rows,
  label,
  className = "",
}: {
  rows: ReactNode[][];
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`feature-carousel ${className}`}
      role="region"
      aria-label={label}
      data-motion-region
    >
      <div
        className="feature-carousel-stage"
        tabIndex={0}
        role="group"
        aria-label="Cards; focus to pause animation"
      >
        <div className="feature-orbit" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        {rows.map((row, rowIndex) => (
          <div className="feature-loop-window" key={rowIndex}>
            <div
              className="feature-loop-track"
              data-direction={rowIndex ? "reverse" : "forward"}
              style={
                {
                  "--loop-duration": `${Math.max(row.length * 12, 30)}s`,
                } as CSSProperties
              }
            >
              <div className="feature-loop-group">{row}</div>
              <div
                className="feature-loop-group feature-loop-clone"
                aria-hidden="true"
              >
                {row}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="feature-carousel-hint">
        Hover to pause. Move away to keep exploring.
      </p>
    </div>
  );
}
