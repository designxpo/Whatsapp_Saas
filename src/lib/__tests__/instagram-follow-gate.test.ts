import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  campaignMode: null as "direct" | "dm" | "comment" | null, campaignExpired: false,
  gate: null as { ruleId: string; channelId: string } | null,
  follows: null as boolean | null, optedOut: false, allowed: true,
  rule: { id: "rule", tenantId: "tenant", channelId: "channel", enabled: true, requireFollow: true, followCheckMode: undefined as "dm" | "comment" | undefined, replyOnly: false, keyword: "guide, info", followPrompt: "", dmMessage: "Your download", buttons: [], publicReplies: [], matchCount: 0 },
  publicReply: vi.fn(), privateReply: vi.fn(), message: vi.fn(), buttons: vi.fn(), followCheck: vi.fn(), clear: vi.fn(), errors: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: () => {} }));
vi.mock("../social-growth", () => ({
  enterSocialCampaign: async (_tid: string, input: { experimentEligible?: boolean }) => h.campaignMode && input.experimentEligible ? { campaign: { variants: [{ id: "a", mode: h.campaignMode }] }, journey: { variant: "a" }, expired: h.campaignExpired } : null,
  campaignForConversation: async () => h.campaignMode ? { campaign: { variants: [{ id: "a", mode: h.campaignMode }] }, journey: { variant: "a" }, expired: h.campaignExpired } : null,
}));
vi.mock("../partner-meta", () => ({}));
vi.mock("../comment-replies", () => ({ recordCommentReply: vi.fn() }));
vi.mock("../handoff", () => ({ ruleInviteLink: async () => null, withInviteButton: (b: unknown) => b }));
vi.mock("../apiauth", () => ({ verifyMetaSignature: () => true }));
vi.mock("../channels", () => ({ getChannelByIgId: async () => ({ id: "channel", tenantId: "tenant", active: true, token: "token", igUserId: "account" }) }));
vi.mock("../store", () => ({
  getOrCreateConversation: async () => ({ id: "conv", name: "@person", avatarUrl: "pic", botEnabled: true, channelId: "channel", leadPhone: "123" }),
  appendConvMessage: vi.fn(async () => {}), touchInbound: vi.fn(async () => {}), touchOutbound: vi.fn(async () => {}), setConversationComment: vi.fn(async () => {}),
  isOptedOut: async () => h.optedOut, claimWebhookEvent: async () => true, logSendFailure: vi.fn(),
}));
vi.mock("../leadsquared", () => ({}));
vi.mock("../llm", () => ({}));
vi.mock("../messaging-settings", () => ({}));
vi.mock("../voice", () => ({}));
vi.mock("../supabase", () => ({}));
vi.mock("../instagram", () => ({
  replyToComment: h.publicReply, sendPrivateReply: h.privateReply, sendIgMessage: h.message, sendIgButtons: h.buttons,
  getFollowStatus: h.followCheck, getIgProfile: async () => ({ username: "business" }),
}));
vi.mock("../sequences", () => ({}));
vi.mock("../flowengine", () => ({}));
vi.mock("../igcomments", () => ({
  matchCommentRule: async () => h.rule, claimComment: async () => true, bumpRuleMatch: vi.fn(),
  getCommentRule: async () => h.rule, getFollowGate: async () => h.gate,
  setFollowGate: async (_user: string, ruleId: string, channelId: string) => { h.gate = { ruleId, channelId }; },
  clearFollowGate: h.clear, pickPublicReply: (rule: { publicReplies?: string[] }) => rule.publicReplies?.[0] || "Sent you a DM",
}));
vi.mock("../commentthreads", () => ({ trackCommentWatch: vi.fn(async () => {}) }));
vi.mock("../feature-guard", () => ({ accountCanSend: async () => h.allowed }));
vi.mock("../cronwatchdog", () => ({}));
import { POST } from "../../app/api/webhooks/instagram/route";

async function deliver(entry: Record<string, unknown>) {
  return POST(new Request("https://test/api/webhooks/instagram", { method: "POST", body: JSON.stringify({ entry: [{ id: "account", ...entry }] }) }));
}
const comment = () => deliver({ changes: [{ field: "comments", value: { id: "comment", text: "guide", from: { id: "person", username: "person" } } }] });
const dm = (text = "guide") => deliver({ messaging: [{ sender: { id: "person" }, message: { text, mid: "message" } }] });
const tap = () => deliver({ messaging: [{ sender: { id: "person" }, postback: { payload: "FOLLOWCHK:rule", mid: "tap" } }] });

beforeEach(() => {
  h.campaignMode = null; h.campaignExpired = false;
  vi.clearAllMocks(); h.rule.requireFollow = true; h.rule.followCheckMode = "comment"; h.gate = null; h.follows = null; h.optedOut = false; h.allowed = true; h.rule.enabled = true;
  h.publicReply.mockResolvedValue({ ok: true, id: "reply" });
  h.privateReply.mockResolvedValue({ ok: true }); h.message.mockResolvedValue({ ok: true }); h.buttons.mockResolvedValue({ ok: true });
  h.followCheck.mockImplementation(async () => h.follows);
  h.clear.mockImplementation(async () => { h.gate = null; });
  vi.spyOn(console, "error").mockImplementation(h.errors);
});

describe("Instagram public comment to verified-follow DM", () => {
  it("asks publicly without an opening DM when comment verification is unavailable", async () => {
    await comment();
    expect(h.publicReply).toHaveBeenCalledWith(expect.anything(), "comment", expect.stringContaining('DM us “guide”'), "tenant");
    expect(h.gate).toEqual({ ruleId: "rule", channelId: "channel" });
    expect(h.privateReply).not.toHaveBeenCalled(); expect(h.message).not.toHaveBeenCalled(); expect(h.followCheck).toHaveBeenCalledOnce();
    expect(h.errors).not.toHaveBeenCalled();
  });
  it("sends the resource immediately when comment verification confirms a follow", async () => {
    h.gate = { ruleId: "rule", channelId: "channel" };
    h.follows = true; await comment();
    expect(h.privateReply).toHaveBeenCalledWith(expect.anything(), "comment", "Your download", [], "tenant");
    expect(h.gate).toBeNull(); expect(h.errors).not.toHaveBeenCalled();
  });
  it.each(["dm", undefined] as const)("keeps the DM-first follow prompt available (mode %s)", async mode => {
    h.rule.followCheckMode = mode; await comment();
    expect(h.privateReply).toHaveBeenCalledWith(expect.anything(), "comment", expect.stringContaining("Follow this account"), expect.arrayContaining([expect.objectContaining({ payload: "FOLLOWCHK:rule" })]), "tenant");
    expect(h.followCheck).not.toHaveBeenCalled(); expect(h.gate).not.toBeNull();
    h.follows = true; await tap();
    expect(h.message).toHaveBeenCalledWith(expect.anything(), "person", "Your download", expect.anything());
    expect(h.gate).toBeNull(); expect(h.errors).not.toHaveBeenCalled();
  });
  it("holds the resource in DM-first mode when verification is unavailable", async () => {
    h.rule.followCheckMode = "dm"; await comment(); await tap();
    expect(h.message).not.toHaveBeenCalled(); expect(h.gate).not.toBeNull();
    expect(h.buttons).toHaveBeenCalledWith(expect.anything(), "person", expect.stringContaining("couldn't verify"), expect.anything(), expect.anything());
    expect(h.errors).not.toHaveBeenCalled();
  });
  it("executes an assigned DM gate and respects it on a later confirmation", async () => {
    h.rule.requireFollow = false; h.campaignMode = "dm";
    await comment(); expect(h.privateReply).toHaveBeenCalledWith(expect.anything(), "comment", expect.stringContaining("Follow this account"), expect.anything(), "tenant");
    h.follows = true; await tap(); expect(h.message).toHaveBeenCalledWith(expect.anything(), "person", "Your download", expect.anything());
    expect(h.errors).not.toHaveBeenCalled();
  });
  it("executes the assigned direct-delivery option without a follow check", async () => {
    h.rule.requireFollow = true; h.campaignMode = "direct";
    await comment(); expect(h.privateReply).toHaveBeenCalledWith(expect.anything(), "comment", "Your download", [], "tenant");
    expect(h.followCheck).not.toHaveBeenCalled(); expect(h.gate).toBeNull();
  });
  it("stops an expired campaign from delivering the resource", async () => {
    h.campaignMode = "dm"; h.campaignExpired = true;
    await comment(); expect(h.privateReply).not.toHaveBeenCalled(); expect(h.publicReply).toHaveBeenCalledWith(expect.anything(), "comment", expect.stringContaining("offer has ended"), "tenant");
    expect(h.errors).not.toHaveBeenCalled();
  });
  it("preserves normal comment-to-DM rules without a follow requirement", async () => {
    h.rule.requireFollow = false; h.privateReply.mockResolvedValue({ ok: true });
    await comment(); expect(h.privateReply).toHaveBeenCalledWith(expect.anything(), "comment", "Your download", [], "tenant");
    expect(h.gate).toBeNull(); expect(h.errors).not.toHaveBeenCalled();
  });
  it.each([true, false, null])("releases the resource only for a confirmed follow (%s)", async follows => {
    await comment(); h.follows = follows; await dm();
    expect(h.followCheck).toHaveBeenCalledWith(expect.anything(), "person");
    if (follows === true) {
      expect(h.message).toHaveBeenCalledWith(expect.anything(), "person", "Your download", expect.anything());
      expect(h.gate).toBeNull();
    } else {
      expect(h.message).not.toHaveBeenCalled(); expect(h.gate).not.toBeNull();
      expect(h.buttons).toHaveBeenCalledWith(expect.anything(), "person", expect.stringContaining(follows === false ? "don't see a follow" : "couldn't verify"), expect.anything(), expect.anything());
    }
    expect(h.errors).not.toHaveBeenCalled();
  });
  it("rechecks a pending gate on confirmation and keeps the resource on send failure", async () => {
    await comment(); h.follows = null; await dm(); h.follows = true;
    h.message.mockResolvedValueOnce({ ok: false, error: "temporary" }); await tap(); expect(h.gate).not.toBeNull();
    await tap(); expect(h.gate).toBeNull();
  });
  it("rejects stale or cross-account postbacks", async () => {
    h.follows = true; await tap();
    h.gate = { ruleId: "rule", channelId: "different-account" }; await tap();
    expect(h.followCheck).not.toHaveBeenCalled(); expect(h.message).not.toHaveBeenCalled();
  });
  it.each(["disabled", "opted-out", "billing"])("holds delivery when %s", async reason => {
    await comment(); h.follows = true;
    if (reason === "disabled") h.rule.enabled = false;
    if (reason === "opted-out") h.optedOut = true;
    if (reason === "billing") h.allowed = false;
    await tap(); expect(h.message).not.toHaveBeenCalled();
  });
});
