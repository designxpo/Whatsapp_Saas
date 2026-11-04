// Client-safe contracts and calculations. No predictions disguised as measurements.
export type GrowthGoal = "lead" | "booking" | "purchase" | "sponsorship";
export type DeliveryMode = "direct" | "dm" | "comment";
export interface SocialVariant {
  id: "a" | "b";
  name: string;
  mode: DeliveryMode;
}
export interface SocialCampaign {
  id: string;
  name: string;
  audience: "business" | "creator";
  channel_id: string;
  platform: "instagram" | "messenger";
  post_id: string | null;
  post_ids?: string[]; // Optional when reading campaigns written before the multi-post migration.
  keyword: string;
  facts: string;
  questions: string[];
  goal: GrowthGoal;
  status: "draft" | "active" | "paused";
  expires_at: string | null;
  variants: SocialVariant[];
  created_at: string;
}
export interface SocialJourney {
  id: string;
  root_journey_id?: string | null;
  campaign_id: string;
  conversation_id: string;
  contact_key: string;
  platform: string;
  variant: string | null;
  answers: Record<string, string>;
  context: string[];
  enrolled_at: string;
}
export interface SocialOutcome {
  id: string;
  journey_id: string;
  kind: GrowthGoal;
  amount_cents: number;
  currency: string;
  evidence: "manual" | "payment";
  reference: string;
}
export interface SocialCommitment {
  id: string;
  conversation_id: string;
  title: string;
  evidence: string;
  owner_email: string | null;
  due_at: string | null;
  status: "needs_review" | "open" | "done" | "dismissed";
  created_at: string;
}
export interface SocialLink {
  source_conversation_id: string;
  target_conversation_id: string;
  handoff_id: string;
  created_at: string;
}
export const CREATOR_PLAYBOOKS = [
  {
    id: "digital",
    name: "Sell a digital resource",
    goal: "purchase" as GrowthGoal,
    keyword: "GUIDE",
    facts: "",
    questions: [
      "What are you trying to achieve?",
      "Which resource are you interested in?",
    ],
    why: "Turn a useful free resource into a relevant paid offer, without inventing urgency.",
  },
  {
    id: "coaching",
    name: "Fill a workshop or coaching session",
    goal: "booking" as GrowthGoal,
    keyword: "WORKSHOP",
    facts: "",
    questions: ["What would you like help with?", "Which session suits you?"],
    why: "Qualify real interest and track bookings and promised follow-ups.",
  },
  {
    id: "brand",
    name: "Qualify a brand partnership",
    goal: "sponsorship" as GrowthGoal,
    keyword: "COLLAB",
    facts: "",
    questions: [
      "Which brand do you represent?",
      "What deliverables and timeline do you have in mind?",
      "What is your budget range?",
    ],
    why: "Keep partnership enquiries and promised media kits from disappearing in the inbox.",
  },
  {
    id: "affiliate",
    name: "Help an audience choose",
    goal: "lead" as GrowthGoal,
    keyword: "COMPARE",
    facts: "",
    questions: ["What is your use case?", "What is your budget range?"],
    why: "Answer using approved product facts and disclosed affiliate relationships. Clicks alone are not purchases.",
  },
];

export function commitmentCandidate(body: string): string | null {
  const text = body.replace(/^\[comment\]\s*/, "").trim();
  // Explicit speaker commitment only; a customer's request is never a promise.
  if (
    !/\b(?:i|we)(?:['’]ll| will)\s+(?:send|call|share|confirm|check|email|follow up|deliver|reply|provide)\b/i.test(
      text,
    )
  )
    return null;
  if (/\b(?:if|might|could|would|example|for instance)\b/i.test(text))
    return null;
  return text.slice(0, 1000);
}

export function experimentReport(
  campaign: SocialCampaign,
  journeys: SocialJourney[],
  outcomes: SocialOutcome[],
) {
  const mine = journeys.filter(
    (j) => j.campaign_id === campaign.id && !j.root_journey_id,
  );
  // Linked channel journeys belong to the original participant: caller provides canonical ids.
  return (
    campaign.variants.length
      ? campaign.variants
      : [{ id: "a", name: "Default", mode: "direct" }]
  ).map((v) => {
    const group = mine.filter((j) => (j.variant ?? "a") === v.id);
    const ids = new Set(group.map((j) => j.id));
    const events = outcomes.filter((o) => ids.has(o.journey_id));
    const converted = new Set(
      events.filter((o) => o.kind === campaign.goal).map((o) => o.journey_id),
    ).size;
    const revenue: Record<string, number> = {};
    for (const o of events)
      if (o.kind === "purchase")
        revenue[o.currency] =
          (revenue[o.currency] ?? 0) + Number(o.amount_cents);
    return {
      variant: v.id,
      name: v.name,
      participants: group.length,
      converted,
      rate: group.length ? converted / group.length : 0,
      revenue,
      manual: events.filter((o) => o.evidence === "manual").length,
      note:
        group.length < 30
          ? "Small sample — do not declare a winner."
          : "Observed outcomes; association does not establish causal lift.",
    };
  });
}

/** ISO currency minor units; JPY has 0 fractional digits, KWD has 3. */
export function minorUnitScale(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) return 100; // incomplete form input is validated on save
  try {
    return (
      10 **
      (new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2)
    );
  } catch {
    return 100;
  }
}

export interface SocialPost {
  id: string;
  caption: string;
  permalink: string;
  thumbnail: string;
  mediaType: string;
  timestamp: string;
}
export interface SocialPostPage {
  posts: SocialPost[];
  next: string | null;
}
export const MAX_CAMPAIGN_POSTS = 200;

/** Legacy single-post campaigns still target that one post. */
export function campaignPostIds(campaign: {
  post_ids?: string[];
  post_id?: string | null;
}): string[] {
  return campaign.post_ids?.length
    ? campaign.post_ids
    : campaign.post_id
      ? [campaign.post_id]
      : [];
}
export function parseCampaignPostIds(input: Record<string, unknown>): string[] {
  if (!("post_ids" in input))
    return typeof input.post_id === "string" && input.post_id.trim()
      ? [input.post_id.trim().slice(0, 150)]
      : [];
  if (
    !Array.isArray(input.post_ids) ||
    input.post_ids.length > MAX_CAMPAIGN_POSTS
  )
    throw new Error(`Select up to ${MAX_CAMPAIGN_POSTS} posts`);
  const ids = input.post_ids.map((value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > 150 ||
      !/^[a-zA-Z0-9_-]+$/.test(value.trim())
    )
      throw new Error(
        "Invalid post selection. Refresh the posts and select again.",
      );
    return value.trim();
  });
  return [...new Set(ids)].sort();
}
