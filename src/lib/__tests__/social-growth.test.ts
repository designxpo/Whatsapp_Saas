import { beforeEach, describe, expect, it, vi } from "vitest";
import { memdb } from "./helpers/memdb";
const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/memdb").MemDb,
  feature: true,
}));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../moderation", () => ({ assertTextsAllowed: async () => {} }));
vi.mock("../entitlements", () => ({
  checkFeature: async () => ({ ok: h.feature }),
}));
import {
  saveSocialCampaign,
  enterSocialCampaign,
  campaignForConversation,
  socialPromptContext,
  observeSocialMessage,
  reviewCommitment,
  captureCommitment,
  removeManualOutcome,
  recordSocialOutcome,
  attributeSocialOrder,
  continueSocialHandoff,
  socialDashboard,
  updateJourneyAnswers,
} from "../social-growth";
import { commitmentCandidate, minorUnitScale, experimentReport } from "../social-growth-policy";
const C = "wa_social_campaigns",
  J = "wa_social_journeys",
  O = "wa_social_outcomes",
  P = "wa_social_commitments";
const variants = [
  { name: "Immediate", mode: "direct" },
  { name: "Verify in DM", mode: "dm" },
];
async function campaign(extra: Record<string, unknown> = {}) {
  return saveSocialCampaign("t1", {
    name: "Creator workshop",
    audience: "creator",
    channel_id: "ig1",
    post_id: "post",
    keyword: "guide",
    facts: "The workshop costs INR 500. Includes a workbook.",
    questions: ["What are you trying to achieve?"],
    goal: "purchase",
    status: "active",
    ...extra,
  });
}
const enter = (conversationId = "conv1") =>
  enterSocialCampaign("t1", {
    conversationId,
    channelId: "ig1",
    postId: "post",
    text: "guide please",
    source: "comment",
    experimentEligible: true,
  });
beforeEach(() => {
  h.feature = true;
  h.db = memdb({
    [J]: [["tenant_id", "campaign_id", "conversation_id"]],
    [O]: [
      ["tenant_id", "event_key"],
      ["tenant_id", "kind", "reference"],
    ],
    [P]: [["tenant_id", "message_id"]],
    wa_social_links: [["tenant_id", "handoff_id"]],
  });
  h.db.tables.wa_channels = [
    { id: "ig1", tenant_id: "t1", kind: "instagram" },
    { id: "fb1", tenant_id: "t1", kind: "messenger" },
    { id: "other", tenant_id: "t2", kind: "instagram" },
  ];
  h.db.tables.wa_conversations = [
    {
      id: "conv1",
      tenant_id: "t1",
      phone: "igsid1",
      platform: "instagram",
      channel_id: "ig1",
    },
    {
      id: "conv2",
      tenant_id: "t1",
      phone: "919900",
      platform: "whatsapp",
      channel_id: "wa1",
    },
    {
      id: "foreign",
      tenant_id: "t2",
      phone: "igsid1",
      platform: "instagram",
      channel_id: "other",
    },
  ];
  h.db.tables.wa_users = [
    { tenant_id: "t1", email: "owner@test.in", active: true },
  ];
});
describe("campaign targeting, consent context and isolation", () => {
  it("matches only the configured account, post and keyword and reuses one assignment", async () => {
    const c = await campaign({ variants });
    const first = await enter(),
      second = await enter();
    expect(first?.campaign.id).toBe(c.id);
    expect(first?.journey?.id).toBe(second?.journey?.id);
    expect(h.db.tables[J]).toHaveLength(1);
    expect(["a", "b"]).toContain(first?.journey?.variant);
    expect(
      await enterSocialCampaign("t1", {
        conversationId: "conv1",
        channelId: "ig1",
        postId: "other",
        text: "guide",
        source: "comment",
      }),
    ).toBeNull();
    expect(
      await enterSocialCampaign("t1", {
        conversationId: "conv1",
        channelId: "ig1",
        postId: "post",
        text: "hello",
        source: "comment",
      }),
    ).toBeNull();
  });
  it("rejects foreign account and conversation references", async () => {
    await expect(campaign({ channel_id: "other" })).rejects.toThrow(
      "workspace",
    );
    await campaign();
    await expect(enter("foreign")).rejects.toThrow("Conversation not found");
  });
  it("does not enrol experiments on ordinary DMs or comments without a delivery rule", async () => {
    await campaign({ post_id: null, variants });
    expect(
      await enterSocialCampaign("t1", {
        conversationId: "conv1",
        channelId: "ig1",
        text: "guide",
        source: "dm",
      }),
    ).toBeNull();
    expect(
      await enterSocialCampaign("t1", {
        conversationId: "conv1",
        channelId: "ig1",
        text: "guide",
        source: "comment",
      }),
    ).toBeNull();
  });
  it("allows DM-keyword campaigns without experiments", async () => {
    await campaign({ post_id: null });
    expect(
      await enterSocialCampaign("t1", {
        conversationId: "conv1",
        channelId: "ig1",
        text: "guide",
        source: "dm",
      }),
    ).not.toBeNull();
  });
  it("requires approved facts and targeting before activation; locks tested configuration after enrolment", async () => {
    await expect(campaign({ facts: "" })).rejects.toThrow("approved facts");
    const c = await campaign({ variants });
    await enter();
    await expect(campaign({ ...c, goal: "booking" })).rejects.toThrow(
      "after participants",
    );
    const paused = await campaign({ ...c, status: "paused" });
    expect(paused.status).toBe("paused");
    expect(await campaignForConversation("t1", "conv1")).toBeNull();
  });
  it("does not silently merge or train on another tenant’s conversations", async () => {
    await campaign();
    await enter();
    expect(await campaignForConversation("t2", "conv1")).toBeNull();
    await expect(socialPromptContext("t2", "conv1")).rejects.toThrow(
      "Conversation not found",
    );
    const context = await socialPromptContext("t1", "conv1");
    expect(context?.facts).toContain("INR 500");
  });
  it("stops expired offers from enrolling more participants and removes stale facts from AI context", async () => {
    await campaign();
    await enter();
    h.db.tables[C][0].expires_at = "2000-01-01T00:00:00Z";
    const expired = await enter();
    expect(expired?.expired).toBe(true);
    expect(expired?.journey).toBeNull();
    expect((await socialPromptContext("t1", "conv1"))?.facts).toBe("");
  });
  it("honours feature entitlement changes", async () => {
    await campaign();
    await enter();
    h.feature = false;
    expect(await enter()).toBeNull();
    expect(await campaignForConversation("t1", "conv1")).toBeNull();
  });
});
describe("promise review and fulfilment", () => {
  it("captures explicit sent promises as suggestions without inventing a deadline", async () => {
    await campaign();
    await observeSocialMessage("t1", {
      conversationId: "conv1",
      id: "msg1",
      role: "assistant",
      body: "I'll send your media kit tomorrow.",
    });
    expect(h.db.tables[P][0]).toMatchObject({
      status: "needs_review",
      evidence: "I'll send your media kit tomorrow.",
    });
    expect(h.db.tables[P][0].due_at).toBeUndefined();
    await expect(
      reviewCommitment(
        "t1",
        String(h.db.tables[P][0].id),
        { status: "open" },
        "owner@test.in",
      ),
    ).rejects.toThrow("owner and due");
  });
  it("requires an active team owner, retains reviewed state on retries, and records fulfilment", async () => {
    await campaign();
    const msg = {
      conversationId: "conv1",
      id: "msg1",
      role: "assistant",
      body: "We will send the quote today.",
    };
    await observeSocialMessage("t1", msg);
    const id = String(h.db.tables[P][0].id),
      due = new Date(Date.now() + 3600000).toISOString();
    await expect(
      reviewCommitment(
        "t1",
        id,
        { status: "open", owner_email: "outside@test.in", due_at: due },
        "owner",
      ),
    ).rejects.toThrow("workspace team");
    await reviewCommitment(
      "t1",
      id,
      { status: "open", owner_email: "owner@test.in", due_at: due },
      "owner",
    );
    await observeSocialMessage("t1", msg);
    expect(h.db.tables[P][0].status).toBe("open");
    await reviewCommitment("t1", id, { status: "done" }, "owner");
    expect(h.db.tables[P][0].completed_at).toBeTruthy();
  });
  it("lets an admin capture a missed promise only from a real sent reply", async () => {
    h.db.tables.wa_conv_messages = [
      {
        id: "msg-hi",
        tenant_id: "t1",
        conversation_id: "conv1",
        role: "assistant",
        body: "मैं आपको कल विवरण भेजूँगा।",
      },
    ];
    await captureCommitment("t1", "conv1", "मैं आपको कल विवरण भेजूँगा।");
    expect(h.db.tables[P][0].status).toBe("needs_review");
    await expect(
      captureCommitment("t1", "conv1", "An invented promise"),
    ).rejects.toThrow("actual sent reply");
  });
  it("does not treat requests, hypothetical examples or customer text as completed commitments", async () => {
    expect(commitmentCandidate("Can you send a quote?")).toBeNull();
    expect(commitmentCandidate("If you book, we will call you.")).toBeNull();
    await campaign();
    await observeSocialMessage("t1", {
      conversationId: "conv1",
      id: "msg",
      role: "user",
      body: "I will send this tomorrow.",
    });
    expect(h.db.tables[P] ?? []).toHaveLength(0);
  });
});
describe("explicit continuity and trustworthy outcomes", () => {
  async function link() {
    const c = await campaign({ variants });
    const first = await enter();
    h.db.tables.wa_conv_messages = [
      {
        id: "m",
        tenant_id: "t1",
        conversation_id: "conv1",
        role: "user",
        body: "I need the advanced workshop",
        created_at: new Date().toISOString(),
      },
    ];
    h.db.tables.wa_handoffs = [
      {
        id: "h",
        tenant_id: "t1",
        source_conversation_id: "conv1",
        channel_id: "ig1",
        platform: "instagram",
        claimed_at: new Date().toISOString(),
        claimed_phone: "919900",
        claimed_conversation_id: "conv2",
      },
    ];
    await continueSocialHandoff("t1", "h", "conv2");
    return { c, first };
  }
  it("carries approved campaign context and qualification through a claimed handoff without doubling participants", async () => {
    const { c, first } = await link();
    const target = h.db.tables[J].find((j) => j.conversation_id === "conv2")!;
    expect(target.root_journey_id).toBe(first?.journey?.id);
    expect(target.context).toEqual(["I need the advanced workshop"]);
    await updateJourneyAnswers("t1", String(target.id), {
      "What are you trying to achieve?": "Launch my course",
      rogue: "ignored",
    });
    expect(
      h.db.tables[J].every(
        (j) =>
          (j.answers as Record<string, string>)[
            "What are you trying to achieve?"
          ] === "Launch my course",
      ),
    ).toBe(true);
    await attributeSocialOrder("t1", {
      id: "paid-order",
      phone: "919900",
      total_cents: 50000,
      currency: "INR",
      conversationId: "conv2",
    });
    await attributeSocialOrder("t1", {
      id: "paid-order",
      phone: "919900",
      total_cents: 50000,
      currency: "INR",
      conversationId: "conv2",
    });
    const dashboard = await socialDashboard("t1");
    const report = dashboard.reports.find((r) => r.campaignId === c.id)!;
    expect(report.variants.reduce((n, v) => n + v.participants, 0)).toBe(1);
    expect(report.variants.reduce((n, v) => n + v.converted, 0)).toBe(1);
    expect(h.db.tables[O]).toHaveLength(1);
    expect(h.db.tables[O][0]).toMatchObject({
      evidence: "payment",
      amount_cents: 50000,
      journey_id: first?.journey?.id,
    });
  });
  it("keeps tracking promises after an explicit WhatsApp handoff", async () => {
    await link();
    h.db.tables.wa_conv_messages.push({
      id: "wa-promise",
      tenant_id: "t1",
      conversation_id: "conv2",
      role: "assistant",
      body: "We will send your workshop details tomorrow.",
    });
    await observeSocialMessage("t1", {
      conversationId: "conv2",
      id: "wa-promise",
      role: "assistant",
      body: "We will send your workshop details tomorrow.",
    });
    expect(h.db.tables[P][0]).toMatchObject({
      conversation_id: "conv2",
      status: "needs_review",
    });
  });
  it("attributes delayed payment callbacks to an enquiry before checkout, not a later campaign", async () => {
    await campaign();
    const first = await enter();
    h.db.tables[J][0].enrolled_at = new Date(
      Date.now() - 2 * 3600000,
    ).toISOString();
    const checkoutTime = new Date(Date.now() - 3600000).toISOString();
    await campaign({ name: "Later offer" });
    await enter();
    await attributeSocialOrder("t1", {
      id: "delayed",
      phone: "igsid1",
      conversationId: "conv1",
      total_cents: 50000,
      currency: "INR",
      createdAt: checkoutTime,
    });
    expect(h.db.tables[O][0].journey_id).toBe(first!.journey!.id);
  });
  it("does not link unclaimed handoffs, wrong phones or a guessed matching name", async () => {
    await campaign();
    await enter();
    await continueSocialHandoff("t1", "missing", "conv2");
    expect(h.db.tables.wa_social_links ?? []).toHaveLength(0);
    h.db.tables.wa_handoffs = [
      {
        id: "h",
        tenant_id: "t1",
        source_conversation_id: "conv1",
        channel_id: "ig1",
        platform: "instagram",
        claimed_at: "now",
        claimed_phone: "other-phone",
        claimed_conversation_id: "conv2",
      },
    ];
    await expect(continueSocialHandoff("t1", "h", "conv2")).rejects.toThrow(
      "identity mismatch",
    );
  });
  it("deduplicates manual references across linked journeys and keeps currencies separate", async () => {
    const { c, first } = await link();
    const rootId = first!.journey!.id,
      target = h.db.tables[J].find((j) => j.conversation_id === "conv2")!;
    const input = {
      kind: "purchase",
      amountCents: 1000,
      currency: "USD",
      reference: "receipt",
      eventKey: "caller-key",
      evidence: "manual" as const,
    };
    await recordSocialOutcome("t1", { ...input, journeyId: rootId });
    await recordSocialOutcome("t1", { ...input, journeyId: String(target.id) });
    await recordSocialOutcome("t1", {
      ...input,
      reference: "receipt2",
      journeyId: rootId,
      currency: "INR",
    });
    const report = experimentReport(
      c,
      (await socialDashboard("t1")).journeys,
      (await socialDashboard("t1")).outcomes,
    );
    expect(report.find((r) => r.participants)?.revenue).toEqual({
      USD: 1000,
      INR: 1000,
    });
    expect(report.find((r) => r.participants)?.converted).toBe(1);
  });
  it("reconciles an identical manual order reference with payment evidence and protects verified records", async () => {
    await campaign();
    const entry = await enter();
    const journeyId = entry!.journey!.id;
    const manual = {
      journeyId,
      kind: "purchase",
      amountCents: 100,
      currency: "INR",
      reference: "order1",
      eventKey: "unused",
      evidence: "manual" as const,
    };
    await recordSocialOutcome("t1", manual);
    await attributeSocialOrder("t1", {
      id: "order1",
      phone: "igsid1",
      total_cents: 50000,
      currency: "INR",
      conversationId: "conv1",
    });
    await recordSocialOutcome("t1", manual);
    expect(h.db.tables[O]).toHaveLength(1);
    expect(h.db.tables[O][0].evidence).toBe("payment");
    await expect(
      removeManualOutcome("t1", String(h.db.tables[O][0].id)),
    ).rejects.toThrow("Only manually");
  });
  it("does not call unlinked purchases revenue or accept negative amounts", async () => {
    await campaign();
    const j = await enter();
    await attributeSocialOrder("t1", {
      id: "unlinked",
      phone: "igsid1",
      total_cents: 100,
      currency: "INR",
    });
    expect(h.db.tables[O] ?? []).toHaveLength(0);
    await expect(
      recordSocialOutcome("t1", {
        journeyId: j!.journey!.id,
        kind: "purchase",
        amountCents: -1,
        reference: "bad",
        eventKey: "bad",
        evidence: "manual",
      }),
    ).rejects.toThrow("valid amount");
    await expect(
      recordSocialOutcome("t2", {
        journeyId: j!.journey!.id,
        kind: "lead",
        reference: "foreign",
        eventKey: "bad",
        evidence: "manual",
      }),
    ).rejects.toThrow("Journey not found");
  });
});

describe("currency minor units", () => {
  it("preserves zero-, two- and three-decimal currency amounts without exchange-rate assumptions", () => {
    expect(minorUnitScale("JPY")).toBe(1);
    expect(minorUnitScale("INR")).toBe(100);
    expect(minorUnitScale("KWD")).toBe(1000);
  });
});
