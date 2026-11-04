import { beforeEach, describe, expect, it, vi } from "vitest";
import { memdb } from "./helpers/memdb";
const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/memdb").MemDb,
  role: "admin",
  tenant: "t1",
  feature: true,
  account: true,
  answer: vi.fn(),
}));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../auth", () => ({
  currentUser: async () =>
    h.role
      ? { role: h.role, tenantId: h.tenant, email: "owner@test.in" }
      : null,
  DEFAULT_TENANT_ID: "default",
}));
vi.mock("../entitlements", () => ({
  checkFeature: async () => ({ ok: h.feature }),
}));
vi.mock("../feature-guard", () => ({
  guardFeature: async () =>
    h.feature ? null : Response.json({ error: "Not in plan" }, { status: 402 }),
  accountCanSend: async () => h.account,
}));
vi.mock("../moderation", () => ({ assertTextsAllowed: async () => {} }));
vi.mock("../ai-gaps", () => ({
  listGaps: async () => ({
    groups: [
      {
        key: "weekend",
        question: "Do you offer weekend workshops?",
        count: 7,
        platforms: ["instagram"],
      },
    ],
  }),
  answerGap: h.answer,
}));
import { GET, POST } from "../../app/api/admin/social-growth/route";
const post = (body: unknown) =>
  POST(
    new Request("https://test/api/admin/social-growth", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  h.db = memdb({
    wa_social_outcomes: [
      ["tenant_id", "event_key"],
      ["tenant_id", "kind", "reference"],
    ],
  });
  h.role = "admin";
  h.tenant = "t1";
  h.feature = true;
  h.account = true;
  h.answer.mockReset().mockResolvedValue({ docId: "doc" });
  h.db.tables.wa_channels = [
    {
      id: "ig1",
      tenant_id: "t1",
      kind: "instagram",
      name: "Creator account",
      access_token: "never expose this",
    },
    { id: "ig2", tenant_id: "t2", kind: "instagram" },
  ];
  h.db.tables.wa_users = [
    { tenant_id: "t1", email: "owner@test.in", active: true },
  ];
  h.db.tables.wa_social_journeys = [
    {
      id: "j1",
      tenant_id: "t1",
      campaign_id: "c1",
      conversation_id: "conv",
      contact_key: "person",
      platform: "instagram",
      variant: null,
      answers: {},
      context: [],
      enrolled_at: new Date().toISOString(),
    },
  ];
  h.db.tables.wa_social_campaigns = [
    {
      id: "c1",
      tenant_id: "t1",
      name: "Offer",
      audience: "creator",
      channel_id: "ig1",
      status: "active",
      facts: "Approved facts",
      questions: [],
      variants: [],
      goal: "purchase",
    },
  ];
});
describe("Social Growth API access and evidence", () => {
  it.each(["", "member", "lead"])("rejects %s users", async (role) => {
    h.role = role;
    expect((await GET()).status).toBe(403);
    expect((await post({ action: "campaign" })).status).toBe(403);
  });
  it("enforces plan and account restrictions without hiding historical data after billing lapses", async () => {
    h.feature = false;
    expect((await GET()).status).toBe(402);
    h.feature = true;
    h.account = false;
    expect((await GET()).status).toBe(200);
    expect((await post({ action: "campaign" })).status).toBe(402);
  });
  it("reads only this tenant and never serializes account tokens", async () => {
    const json = await (await GET()).json();
    expect(json.channels).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain("never expose");
    h.tenant = "t2";
    const other = await (await GET()).json();
    expect(other.campaigns).toEqual([]);
    expect(other.journeys).toEqual([]);
  });
  it("prevents clients claiming payment verification and deduplicates repeat manual receipts", async () => {
    const payload = {
      action: "outcome",
      journeyId: "j1",
      kind: "purchase",
      amountCents: 50000,
      currency: "INR",
      reference: "receipt1",
      evidence: "payment",
    };
    expect((await post(payload)).status).toBe(200);
    expect((await post(payload)).status).toBe(200);
    expect(h.db.tables.wa_social_outcomes).toHaveLength(1);
    expect(h.db.tables.wa_social_outcomes[0].evidence).toBe("manual");
  });
  it("rejects cross-tenant outcomes and invalid actions", async () => {
    h.tenant = "t2";
    expect(
      (
        await post({
          action: "outcome",
          journeyId: "j1",
          kind: "lead",
          reference: "x",
        })
      ).status,
    ).toBe(400);
    expect((await post({ action: "unknown" })).status).toBe(400);
  });
  it("turns actual unanswered demand into a draft without inventing offer facts", async () => {
    const response = await post({
      action: "demand_campaign",
      key: "weekend",
      channel_id: "ig1",
      audience: "creator",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).campaign).toMatchObject({
      status: "draft",
      facts: "",
      questions: ["Do you offer weekend workshops?"],
    });
    expect(
      (
        await post({
          action: "demand_campaign",
          key: "fabricated",
          channel_id: "ig1",
        })
      ).status,
    ).toBe(400);
  });
  it("saves an explicitly approved answer through the existing knowledge-gap workflow", async () => {
    expect(
      (
        await post({
          action: "answer_demand",
          key: "weekend",
          answer: "Our next workshop is Saturday.",
          tag: "creator",
        })
      ).status,
    ).toBe(200);
    expect(h.answer).toHaveBeenCalledWith(
      "t1",
      "weekend",
      "Our next workshop is Saturday.",
      "owner@test.in",
      "creator",
    );
  });
});
