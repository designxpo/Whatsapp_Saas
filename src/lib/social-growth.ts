import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { assertTextsAllowed } from "./moderation";
import { checkFeature } from "./entitlements";
import { tdb } from "./tenantdb";
import {
  commitmentCandidate,
  experimentReport,
  type SocialCampaign,
  type SocialJourney,
  type SocialOutcome,
  type SocialCommitment,
  type SocialLink,
} from "./social-growth-policy";

type SocialTables = {
  wa_social_campaigns: SocialCampaign;
  wa_social_journeys: SocialJourney;
  wa_social_outcomes: SocialOutcome;
  wa_social_commitments: SocialCommitment;
  wa_social_links: SocialLink;
  wa_channels: { id: string; kind: string };
  wa_conversations: {
    id: string;
    phone: string;
    platform: string;
    channel_id: string;
  };
  wa_users: { email: string };
  wa_conv_messages: { id: string; body: string };
  wa_handoffs: {
    claimed_at: string | null;
    source_conversation_id: string | null;
    claimed_conversation_id: string | null;
    claimed_phone: string | null;
    channel_id: string | null;
    platform: string;
  };
};
type SocialDatabase = {
  public: {
    Tables: {
      [K in keyof SocialTables]: {
        Row: SocialTables[K] & { tenant_id: string } & Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
  };
};
function socialDb(tid: string) {
  const scoped = tdb(tid),
    client = scoped.raw as unknown as SupabaseClient<SocialDatabase>;
  return {
    from<K extends keyof SocialTables>(name: K) {
      const b = scoped.from(name);
      return {
        ...b,
        select: (
          columns = "*",
          opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
        ) =>
          client
            .from(name)
            .select(columns as "*", opts)
            .eq("tenant_id" as never, tid as never),
      };
    },
  };
}

const C = "wa_social_campaigns",
  J = "wa_social_journeys",
  O = "wa_social_outcomes",
  P = "wa_social_commitments",
  L = "wa_social_links";
export const SOCIAL_SETUP =
  "Apply migration 20261104175338_social_growth_workflows.sql to enable Social Growth.";
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const isMissing = (e: { code?: string } | null) =>
  !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");

async function conversation(tid: string, id: string) {
  const { data, error } = await socialDb(tid)
    .from("wa_conversations")
    .select("id,phone,platform,channel_id")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  if (!data) throw new Error("Conversation not found");
  return data;
}
export async function saveSocialCampaign(
  tid: string,
  input: Record<string, unknown>,
) {
  const channelId = text(input.channel_id, 80);
  const { data: channel, error: ce } = await socialDb(tid)
    .from("wa_channels")
    .select("id,kind")
    .eq("id", channelId)
    .maybeSingle();
  fail(ce);
  if (!channel || !["instagram", "messenger"].includes(channel.kind))
    throw new Error(
      "Choose an Instagram account or Facebook Page in this workspace.",
    );
  const status = text(input.status, 20) || "draft";
  if (!["draft", "active", "paused"].includes(status))
    throw new Error("Invalid campaign status");
  const goal = text(input.goal, 20) || "lead";
  if (!["lead", "booking", "purchase", "sponsorship"].includes(goal))
    throw new Error("Invalid goal");
  const name = text(input.name, 100),
    facts = text(input.facts, 6000);
  if (!name) throw new Error("Name the campaign");
  const postId = text(input.post_id, 150) || null,
    keyword = text(input.keyword, 100);
  if (status === "active" && (!facts || (!postId && !keyword)))
    throw new Error(
      "Add approved facts and a post ID or a distinctive keyword before activating.",
    );
  const questions = Array.isArray(input.questions)
    ? input.questions
        .map((q) => text(q, 200))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const variants = Array.isArray(input.variants) ? input.variants : [];
  if (variants.length !== 0 && variants.length !== 2)
    throw new Error("An experiment needs exactly two variants");
  const clean = variants.map((v, i) => {
    const o = v as Record<string, unknown>;
    if (!["direct", "dm", "comment"].includes(String(o.mode)))
      throw new Error("Invalid delivery option");
    return {
      id: i === 0 ? "a" : "b",
      name: text(o.name, 60) || `Variant ${i + 1}`,
      mode: o.mode,
    };
  });
  if (clean.length && channel.kind !== "instagram")
    throw new Error(
      "Follow-mode experiments currently require Instagram. Facebook campaigns still support outcome tracking.",
    );
  const expires = input.expires_at ? new Date(String(input.expires_at)) : null;
  if (expires && !Number.isFinite(expires.getTime()))
    throw new Error("Enter a valid deadline");
  if (expires && status === "active" && expires.getTime() <= Date.now())
    throw new Error("The campaign deadline must be in the future");
  await assertTextsAllowed([name, facts, ...questions], {
    tenantId: tid,
    surface: "comment_rule",
  });
  const row = {
    name,
    facts,
    channel_id: channelId,
    platform: channel.kind,
    post_id: postId,
    keyword,
    questions,
    goal,
    status,
    expires_at: expires?.toISOString() ?? null,
    variants: clean,
    audience: input.audience === "creator" ? "creator" : "business",
  };
  const id = text(input.id, 80);
  if (id) {
    const { data: old, error } = await socialDb(tid)
      .from(C)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    fail(error);
    if (!old) throw new Error("Campaign not found");
    const { data: assigned, error: ae } = await socialDb(tid)
      .from(J)
      .select("id")
      .eq("campaign_id", id)
      .limit(1);
    fail(ae);
    if (
      assigned?.length &&
      (JSON.stringify(old.variants) !== JSON.stringify(clean) ||
        old.channel_id !== channelId ||
        old.post_id !== postId ||
        old.keyword !== keyword ||
        old.goal !== goal)
    )
      throw new Error(
        "Create a new campaign to change targeting, goal or variants after participants have entered.",
      );
  }
  const result = id
    ? await socialDb(tid).from(C).update(row).eq("id", id).select("*").single()
    : await socialDb(tid).from(C).insert(row).select("*").single();
  fail(result.error);
  return result.data as SocialCampaign;
}

/** Stable allocation, stored once. Retries never move a person between variants. */
export async function enterSocialCampaign(
  tid: string,
  input: {
    conversationId: string;
    channelId: string;
    postId?: string | null;
    text: string;
    source?: "comment" | "dm";
    experimentEligible?: boolean;
  },
) {
  if (!(await checkFeature(tid, "growth")).ok) return null;
  const { data: campaigns, error } = await socialDb(tid)
    .from(C)
    .select("*")
    .eq("channel_id", input.channelId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(100);
  if (isMissing(error)) return null;
  fail(error);
  const now = Date.now();
  const matches = (campaigns ?? []).filter(
    (c) =>
      (!c.variants.length ||
        (input.source === "comment" && input.experimentEligible)) &&
      (!c.post_id || c.post_id === input.postId) &&
      (!c.keyword ||
        input.text.toLowerCase().includes(c.keyword.toLowerCase())),
  );
  matches.sort(
    (a, b) =>
      Number(!!b.post_id) - Number(!!a.post_id) ||
      Number(!!b.keyword) - Number(!!a.keyword),
  );
  const campaign = matches[0] as SocialCampaign | undefined;
  if (!campaign) return null;
  if (campaign.expires_at && Date.parse(campaign.expires_at) <= now)
    return { campaign, journey: null, expired: true };
  const conv = await conversation(tid, input.conversationId);
  if (
    conv.channel_id !== input.channelId ||
    conv.platform !== campaign.platform
  )
    throw new Error("Campaign account does not match conversation");
  const existing = await socialDb(tid)
    .from(J)
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("conversation_id", input.conversationId)
    .maybeSingle();
  fail(existing.error);
  if (existing.data)
    return {
      campaign,
      journey: existing.data as SocialJourney,
      expired: false,
    };
  const variant = campaign.variants.length
    ? campaign.variants[
        createHash("sha256")
          .update(`${tid}:${campaign.id}:${conv.platform}:${conv.phone}`)
          .digest()[0] % 2
      ].id
    : null;
  const inserted = await socialDb(tid)
    .from(J)
    .insert({
      campaign_id: campaign.id,
      conversation_id: conv.id,
      contact_key: conv.phone,
      platform: conv.platform,
      variant,
      answers: {},
      context: [],
      root_journey_id: null,
      enrolled_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (inserted.error?.code === "23505") {
    const retry = await socialDb(tid)
      .from(J)
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("conversation_id", conv.id)
      .single();
    fail(retry.error);
    return { campaign, journey: retry.data as SocialJourney, expired: false };
  }
  fail(inserted.error);
  return { campaign, journey: inserted.data as SocialJourney, expired: false };
}

export async function campaignForConversation(
  tid: string,
  conversationId: string,
) {
  if (!(await checkFeature(tid, "growth")).ok) return null;
  const result = await socialDb(tid)
    .from(J)
    .select("*")
    .eq("conversation_id", conversationId)
    .order("enrolled_at", { ascending: false })
    .limit(1);
  if (isMissing(result.error)) return null;
  fail(result.error);
  const journey = result.data?.[0] as SocialJourney | undefined;
  if (!journey) return null;
  const { data, error } = await socialDb(tid)
    .from(C)
    .select("*")
    .eq("id", journey.campaign_id)
    .maybeSingle();
  fail(error);
  const campaign = data as SocialCampaign | null;
  if (!campaign || campaign.status !== "active") return null;
  const expired =
    !!campaign.expires_at && Date.parse(campaign.expires_at) <= Date.now();
  return { campaign, journey, expired };
}
export async function socialPromptContext(tid: string, conversationId: string) {
  await conversation(tid, conversationId);
  const ctx = await campaignForConversation(tid, conversationId);
  if (!ctx) return null;
  const { campaign: c, journey: j, expired } = ctx;
  return {
    facts: expired ? "" : c.facts,
    data: JSON.stringify({
      campaign: c.name,
      goal: c.goal,
      expired,
      approvedFacts: expired
        ? "This offer expired; do not offer its price, availability or deadline."
        : c.facts,
      qualificationQuestions: expired ? [] : c.questions,
      recordedAnswers: j.answers,
      priorChannelCustomerMessages: j.context,
    }),
  };
}

export async function observeSocialMessage(
  tid: string,
  p: { conversationId: string; id: string; role: string; body: string },
) {
  if (p.role !== "assistant") return;
  const candidate = commitmentCandidate(p.body);
  if (!candidate) return;
  if (!(await checkFeature(tid, "growth")).ok) return;
  // Do not activate promises without a human confirming owner and due date.
  const conv = await conversation(tid, p.conversationId);
  const activeJourney = await campaignForConversation(tid, conv.id);
  if (!activeJourney) {
    const { data: active, error: ae } = await socialDb(tid)
      .from(C)
      .select("id")
      .eq("channel_id", conv.channel_id)
      .eq("status", "active")
      .limit(1);
    if (isMissing(ae)) return;
    fail(ae);
    if (!active?.length) return;
  }
  const { error } = await socialDb(tid)
    .from(P)
    .upsert(
      {
        conversation_id: conv.id,
        message_id: p.id,
        title: candidate.slice(0, 160),
        evidence: candidate,
        status: "needs_review",
      },
      { onConflict: "tenant_id,message_id", ignoreDuplicates: true },
    );
  if (!isMissing(error)) fail(error);
}

/** An admin can capture wording the conservative English detector did not recognise. */
export async function captureCommitment(
  tid: string,
  conversationId: string,
  evidence: string,
) {
  await conversation(tid, conversationId);
  const { data, error } = await socialDb(tid)
    .from("wa_conv_messages")
    .select("id,body")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(100);
  fail(error);
  const message = (data ?? []).find(
    (m) => m.body.replace(/^\[comment\]\s*/, "").trim() === evidence.trim(),
  );
  if (!message)
    throw new Error(
      "Paste an actual sent reply from the latest 100 replies in this conversation.",
    );
  const { error: e } = await socialDb(tid)
    .from(P)
    .upsert(
      {
        conversation_id: conversationId,
        message_id: message.id,
        title: evidence.trim().slice(0, 160),
        evidence: evidence.trim().slice(0, 1000),
        status: "needs_review",
      },
      { onConflict: "tenant_id,message_id", ignoreDuplicates: true },
    );
  fail(e);
}

export async function reviewCommitment(
  tid: string,
  id: string,
  input: Record<string, unknown>,
  actor: string,
) {
  const status = String(input.status);
  if (!["open", "done", "dismissed"].includes(status))
    throw new Error("Invalid commitment action");
  const { data: old, error } = await socialDb(tid)
    .from(P)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  if (!old) throw new Error("Commitment not found");
  const owner = text(input.owner_email, 254) || old.owner_email;
  const due = input.due_at
    ? new Date(String(input.due_at)).toISOString()
    : old.due_at;
  if (status === "open") {
    if (!owner || !due)
      throw new Error(
        "Choose an owner and due date before opening this commitment",
      );
    const { data: user, error: ue } = await socialDb(tid)
      .from("wa_users")
      .select("email")
      .eq("email", owner)
      .eq("active", true)
      .maybeSingle();
    fail(ue);
    if (!user) throw new Error("Choose an active workspace team member");
  }
  if (status === "done" && old.status !== "open")
    throw new Error("Only an accepted commitment can be completed");
  const result = await socialDb(tid)
    .from(P)
    .update({
      status,
      owner_email: owner,
      due_at: due,
      reviewed_by: actor,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("*")
    .single();
  fail(result.error);
  return result.data;
}

export async function recordSocialOutcome(
  tid: string,
  input: {
    journeyId: string;
    kind: string;
    amountCents?: number;
    currency?: string;
    reference: string;
    eventKey: string;
    evidence: "manual" | "payment";
  },
) {
  const { data: journey, error: je } = await socialDb(tid)
    .from(J)
    .select("*")
    .eq("id", input.journeyId)
    .maybeSingle();
  fail(je);
  if (!journey) throw new Error("Journey not found");
  if (!["lead", "booking", "purchase", "sponsorship"].includes(input.kind))
    throw new Error("Invalid outcome");
  const amount = input.amountCents ?? 0,
    currency = input.currency ?? "INR";
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    !input.reference.trim() ||
    !input.eventKey.trim()
  )
    throw new Error(
      "Add a reference, valid amount in minor units and three-letter currency",
    );
  const rootId = journey.root_journey_id ?? journey.id;
  const reference = input.reference.trim().slice(0, 200);
  if (input.kind === "purchase") {
    const known = await socialDb(tid)
      .from(O)
      .select("journey_id")
      .eq("kind", "purchase")
      .eq("reference", reference)
      .eq("evidence", "payment")
      .limit(1);
    fail(known.error);
    if (known.data?.length) return;
  }
  const key =
    input.evidence === "manual"
      ? `manual:${createHash("sha256").update(`${rootId}:${input.kind}:${reference}`).digest("hex")}`
      : input.eventKey;
  const { error } = await socialDb(tid)
    .from(O)
    .upsert(
      {
        journey_id: rootId,
        kind: input.kind,
        amount_cents: amount,
        currency,
        evidence: input.evidence,
        reference,
        event_key: key.slice(0, 200),
      },
      {
        onConflict: "tenant_id,kind,reference",
        ignoreDuplicates: input.evidence === "manual",
      },
    );
  fail(error);
}

/** Payment webhook only. Most-recent tracked enquiry within 30 days, once per order. */
export async function attributeSocialOrder(
  tid: string,
  order: {
    id: string;
    phone: string;
    total_cents: number;
    currency: string;
    conversationId?: string | null;
    createdAt?: string;
  },
) {
  const at = order.createdAt ? Date.parse(order.createdAt) : Date.now();
  if (!Number.isFinite(at)) throw new Error("Invalid checkout time");
  if (!order.conversationId) return;
  let q = socialDb(tid)
    .from(J)
    .select("*")
    .eq("contact_key", order.phone)
    .gte("enrolled_at", new Date(at - 30 * 86400000).toISOString())
    .lte("enrolled_at", new Date(at).toISOString())
    .order("enrolled_at", { ascending: false })
    .limit(1);
  if (order.conversationId) q = q.eq("conversation_id", order.conversationId);
  const { data, error } = await q;
  if (isMissing(error)) return;
  fail(error);
  if (!data?.[0]) return;
  await recordSocialOutcome(tid, {
    journeyId: data[0].id,
    kind: "purchase",
    amountCents: order.total_cents,
    currency: order.currency,
    reference: order.id,
    eventKey: `order:${order.id}`,
    evidence: "payment",
  });
}

/** Only a claimed, customer-initiated handoff links identities. Never match display names. */
export async function continueSocialHandoff(
  tid: string,
  handoffId: string,
  targetId: string,
) {
  const { data: h, error: he } = await socialDb(tid)
    .from("wa_handoffs")
    .select("*")
    .eq("id", handoffId)
    .maybeSingle();
  if (isMissing(he)) return;
  fail(he);
  if (
    !h?.claimed_at ||
    !h.source_conversation_id ||
    h.claimed_conversation_id !== targetId
  )
    return;
  const target = await conversation(tid, targetId),
    source = await conversation(tid, h.source_conversation_id);
  if (
    source.channel_id !== h.channel_id ||
    source.platform !== (h.platform === "facebook" ? "messenger" : h.platform)
  )
    throw new Error("Handoff source account mismatch");
  if (target.platform !== "whatsapp" || target.phone !== h.claimed_phone)
    throw new Error("Handoff identity mismatch");
  const { data: rows, error } = await socialDb(tid)
    .from(J)
    .select("*")
    .eq("conversation_id", source.id)
    .order("enrolled_at", { ascending: false })
    .limit(20);
  if (isMissing(error)) return;
  fail(error);
  const messages = await socialDb(tid)
    .from("wa_conv_messages")
    .select("body")
    .eq("conversation_id", source.id)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(8);
  fail(messages.error);
  const context = (messages.data ?? [])
    .reverse()
    .map((m) => String(m.body).slice(0, 500));
  for (const j of rows ?? []) {
    const { error: e } = await socialDb(tid)
      .from(J)
      .upsert(
        {
          campaign_id: j.campaign_id,
          conversation_id: targetId,
          contact_key: target.phone,
          platform: "whatsapp",
          variant: j.variant,
          answers: j.answers,
          context,
          enrolled_at: j.enrolled_at,
          root_journey_id: j.root_journey_id ?? j.id,
        },
        {
          onConflict: "tenant_id,campaign_id,conversation_id",
          ignoreDuplicates: true,
        },
      );
    fail(e);
  }
  const { error: le } = await socialDb(tid).from(L).upsert(
    {
      handoff_id: handoffId,
      source_conversation_id: source.id,
      target_conversation_id: targetId,
    },
    { onConflict: "tenant_id,handoff_id", ignoreDuplicates: true },
  );
  fail(le);
}
export async function removeManualOutcome(tid: string, id: string) {
  const { data, error } = await socialDb(tid)
    .from(O)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  if (!data || data.evidence !== "manual")
    throw new Error("Only manually reported outcomes can be removed.");
  const { error: e } = await socialDb(tid)
    .from(O)
    .delete()
    .eq("id", id)
    .eq("evidence", "manual");
  fail(e);
}
export async function updateJourneyAnswers(
  tid: string,
  id: string,
  answers: unknown,
) {
  const { data: journey, error } = await socialDb(tid)
    .from(J)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  fail(error);
  if (!journey) throw new Error("Journey not found");
  const { data: campaign, error: ce } = await socialDb(tid)
    .from(C)
    .select("questions")
    .eq("id", journey.campaign_id)
    .single();
  fail(ce);
  const clean: Record<string, string> = {};
  if (!campaign) throw new Error("Campaign not found");
  for (const q of campaign.questions as string[]) {
    const a =
      answers && typeof answers === "object"
        ? (answers as Record<string, unknown>)[q]
        : null;
    if (typeof a === "string") clean[q] = a.trim().slice(0, 600);
  }
  const rootId = journey.root_journey_id ?? journey.id;
  const { error: e } = await socialDb(tid)
    .from(J)
    .update({ answers: clean })
    .eq("id", rootId);
  fail(e);
  const { error: linkedError } = await socialDb(tid)
    .from(J)
    .update({ answers: clean })
    .eq("root_journey_id", rootId);
  fail(linkedError);
}
export async function socialDashboard(tid: string) {
  const reads = await Promise.all([
    socialDb(tid)
      .from(C)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    socialDb(tid)
      .from(J)
      .select("*")
      .order("enrolled_at", { ascending: false })
      .limit(1000),
    socialDb(tid)
      .from(O)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000),
    socialDb(tid)
      .from(P)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    socialDb(tid)
      .from(L)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (reads.some((r) => isMissing(r.error)))
    return {
      setupNeeded: SOCIAL_SETUP,
      campaigns: [],
      journeys: [],
      outcomes: [],
      commitments: [],
      links: [],
      reports: [],
      bounded: false,
    };
  reads.forEach((r) => fail(r.error));
  const campaigns = reads[0].data as SocialCampaign[],
    journeys = reads[1].data as SocialJourney[],
    outcomes = reads[2].data as SocialOutcome[];
  return {
    campaigns,
    journeys,
    outcomes,
    commitments: reads[3].data as SocialCommitment[],
    links: reads[4].data as SocialLink[],
    reports: campaigns.map((c) => ({
      campaignId: c.id,
      variants: experimentReport(c, journeys, outcomes),
    })),
    bounded: reads.some(
      (r, i) => (r.data?.length ?? 0) >= [200, 1000, 1000, 500, 500][i],
    ),
  };
}
