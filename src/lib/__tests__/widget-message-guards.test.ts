// /api/widget/message is public (the site key is in the business's page
// source) and every accepted message runs a paid AI turn. These check the
// guards on it: a per-address limit and a per-site ceiling (refused with the
// widget's CORS headers, and before anything is stored), a bounded history sent
// to the model, and that a phone number typed in chat which already belongs to
// an existing contact is never treated as that contact.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  conv: {} as Record<string, unknown>,
  history: [] as { role: "user" | "assistant"; body: string }[],
  landed: "new" as string | null,
}));

vi.mock("next/server", async orig => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
// The shared counter is "down", so the limiter runs on its per-instance
// fallback — the real counting logic, with no database.
vi.mock("../supabase", () => ({ db: () => ({ rpc: async () => ({ data: null, error: { message: "test: no database" } }) }) }));
vi.mock("../channels", () => ({
  getChannelBySiteKey: async (siteKey: string) => ({ id: `ch-${siteKey}`, tenantId: "t1", active: true, allowedOrigins: [], crmSource: null }),
  effectiveAgentId: () => null,
  effectiveKbScope: () => null,
}));
vi.mock("../store", () => ({
  UNVERIFIED_PHONE_LABEL: "phone-unverified",
  getOrCreateConversation: vi.fn(async () => ({ ...h.conv })),
  appendConvMessage: vi.fn(async () => ({ id: "m1", createdAt: "2026-11-06T00:00:00Z" })),
  touchInbound: vi.fn(async () => undefined),
  touchOutbound: vi.fn(async () => undefined),
  getConvHistory: vi.fn(async () => h.history),
  escalateConversation: vi.fn(async () => undefined),
  getContactByPhone: vi.fn(async () => null),
  setConversationLeadPhone: vi.fn(async () => undefined),
  setConversationName: vi.fn(async () => true),
  setContactAttributes: vi.fn(async () => undefined),
  landCapturedLead: vi.fn(async () => h.landed),
}));
vi.mock("../llm", () => ({ generateReply: vi.fn(async () => ({ reply: "Happy to help!" })), deferredToTeam: () => false }));
vi.mock("../messaging-settings", () => ({ isAiEnabled: async () => true }));
vi.mock("../flowengine", () => ({ handleFlowMessage: async () => false }));
vi.mock("../leadsquared", async orig => ({
  ...(await orig<typeof import("../leadsquared")>()),
  pushChatActivity: vi.fn(async () => undefined),
  phoneFromAttributes: () => undefined,
}));

import { POST } from "../../app/api/widget/message/route";
import * as store from "../store";
import * as llm from "../llm";
import * as lsq from "../leadsquared";

const ORIGIN = "https://shop.example.com";
function send(opts: { ip: string; siteKey?: string; text?: string; utm?: Record<string, string> }) {
  return POST(new Request("https://app.thetalko.in/api/widget/message", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": opts.ip },
    body: JSON.stringify({ siteKey: opts.siteKey ?? "site-a", visitorId: "v1", text: opts.text ?? "hi", utm: opts.utm }),
  }));
}

let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
let siteSeq = 0;
const freshSite = () => `site-${++siteSeq}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.conv = { id: "c1", phone: "web:v1", name: "Website visitor", botEnabled: true, status: "active", leadPhone: null, labels: [], agentId: null, primaryKbTag: null };
  h.history = [{ role: "user", body: "hi" }];
  h.landed = "new";
});

describe("rate limits", () => {
  it("lets 60 messages from one address through in five minutes, then refuses with CORS headers", async () => {
    const ip = freshIp();
    const site = freshSite();
    for (let i = 0; i < 60; i++) expect((await send({ ip, siteKey: site })).status).toBe(200);
    const appendsBefore = vi.mocked(store.appendConvMessage).mock.calls.length;
    const aiBefore = vi.mocked(llm.generateReply).mock.calls.length;

    const r = await send({ ip, siteKey: site });
    expect(r.status).toBe(429);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await r.json()).error).toMatch(/Too many messages/);
    // Refused before anything was stored or any AI ran.
    expect(vi.mocked(store.appendConvMessage).mock.calls.length).toBe(appendsBefore);
    expect(vi.mocked(llm.generateReply).mock.calls.length).toBe(aiBefore);
  });

  it("another address on the same site is not affected by one noisy visitor", async () => {
    const site = freshSite();
    const noisy = freshIp();
    for (let i = 0; i < 61; i++) await send({ ip: noisy, siteKey: site });
    expect((await send({ ip: freshIp(), siteKey: site })).status).toBe(200);
  });

  it("caps one site at 600 a minute even when every message comes from a different address", async () => {
    const site = freshSite();
    for (let i = 0; i < 600; i++) expect((await send({ ip: freshIp(), siteKey: site })).status).toBe(200);
    const r = await send({ ip: freshIp(), siteKey: site });
    expect(r.status).toBe(429);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    // A different site is unaffected.
    expect((await send({ ip: freshIp(), siteKey: freshSite() })).status).toBe(200);
  });
});

describe("history sent to the AI", () => {
  it("is trimmed per message and in total, keeping the newest", async () => {
    h.history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", body: `${i}:` + "x".repeat(3990) }) as { role: "user" | "assistant"; body: string });
    await send({ ip: freshIp(), siteKey: freshSite() });
    const sent = vi.mocked(llm.generateReply).mock.calls[0][0] as { body: string }[];
    const total = sent.reduce((n, m) => n + m.body.length, 0);
    expect(total).toBeLessThanOrEqual(12000);
    expect(sent.every(m => m.body.length <= 2000)).toBe(true);
    expect(sent[sent.length - 1].body.startsWith("19:")).toBe(true);   // the latest message is kept
  });

  it("a short chat goes through untouched", async () => {
    h.history = [{ role: "user", body: "hi" }, { role: "assistant", body: "hello" }, { role: "user", body: "price?" }];
    await send({ ip: freshIp(), siteKey: freshSite() });
    expect(vi.mocked(llm.generateReply).mock.calls[0][0]).toEqual(h.history.map(m => ({ ...m, mediaUrl: undefined, mediaType: undefined })));
  });
});

describe("a phone number typed in web chat", () => {
  const PHONE_MSG = "my number is 9876543210";

  it("a NEW number is captured and synced to the CRM as before", async () => {
    h.landed = "new";
    await send({ ip: freshIp(), siteKey: freshSite(), text: PHONE_MSG, utm: { utm_source: "google" } });
    expect(store.setConversationLeadPhone).toHaveBeenCalledWith("c1", "9876543210");
    expect(store.landCapturedLead).toHaveBeenCalledWith("web:v1", "9876543210", "web-chat", "t1");
    expect(store.setContactAttributes).toHaveBeenCalledWith("9876543210", { utm_source: "google" }, "t1");
    expect(lsq.pushChatActivity).toHaveBeenCalledWith(expect.objectContaining({ phone: "9876543210", direction: "inbound" }));
  });

  it("an EXISTING contact's number is recorded but never written to their contact or CRM timeline", async () => {
    h.landed = "unverified";
    await send({ ip: freshIp(), siteKey: freshSite(), text: PHONE_MSG, utm: { utm_source: "google" } });
    expect(store.setConversationLeadPhone).toHaveBeenCalledWith("c1", "9876543210");   // agents still see it
    expect(store.setContactAttributes).not.toHaveBeenCalled();
    expect(store.setConversationName).not.toHaveBeenCalled();
    expect(lsq.pushChatActivity).not.toHaveBeenCalled();                                 // neither inbound nor the AI reply
  });

  it("later messages in a chat flagged unverified stay off that lead's CRM timeline", async () => {
    h.conv = { ...h.conv, leadPhone: "9876543210", labels: ["phone-unverified"] };
    await send({ ip: freshIp(), siteKey: freshSite(), text: "still me" });
    expect(lsq.pushChatActivity).not.toHaveBeenCalled();
  });

  it("once an agent removes the label, the chat syncs again", async () => {
    h.conv = { ...h.conv, leadPhone: "9876543210", labels: [] };
    await send({ ip: freshIp(), siteKey: freshSite(), text: "still me" });
    expect(lsq.pushChatActivity).toHaveBeenCalledWith(expect.objectContaining({ phone: "9876543210" }));
  });
});
