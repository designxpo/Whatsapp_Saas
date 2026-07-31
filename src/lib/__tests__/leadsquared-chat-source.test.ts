import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushChatActivity, pushIgActivity } from "../leadsquared";

// Messenger/Instagram/Web-chat channels each have their own "CRM lead source"
// setting (same field WhatsApp already used) — this locks in that it actually
// reaches LSQ instead of every non-WhatsApp channel silently defaulting to its
// generic platform label ("Messenger"/"Instagram"/"Web chat") for every lead.
describe("pushChatActivity / pushIgActivity lead source attribution", () => {
  const calls: { url: string; body?: string }[] = [];
  function stubNewLead() {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: { body?: string }) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("RetrieveLeadByPhoneNumber")) return { ok: true, json: async () => [] } as unknown as Response;
      return { ok: true, json: async () => ({ Message: { Id: "NEW" } }), text: async () => "" } as unknown as Response;
    }));
  }
  beforeEach(() => {
    process.env.LSQ_ACCESS_KEY = "ak";
    process.env.LSQ_SECRET_KEY = "sk";
    process.env.LSQ_API_HOST = "https://api-test.leadsquared.com";
    process.env.LSQ_ACTIVITY_CODE = "210";
    process.env.LSQ_AUTOCREATE_LEADS = "true";   // unlike internal, SaaS's boolish() defaults OFF
  });
  afterEach(() => vi.unstubAllGlobals());
  const captureBody = () => JSON.parse(calls.find(c => c.url.includes("Lead.Capture"))!.body!);

  it("stamps a Messenger channel's configured source on a NEW lead", async () => {
    stubNewLead();
    await pushChatActivity({ phone: "+919000000010", direction: "inbound", body: "hi", via: "lead", channel: "Messenger", source: "fb-ads" });
    const src = captureBody().find((f: { Attribute: string }) => f.Attribute === "Source");
    expect(src.Value).toBe("fb-ads");
  });

  it("falls back to the platform label when a Messenger channel has no configured source", async () => {
    stubNewLead();
    await pushChatActivity({ phone: "+919000000011", direction: "inbound", body: "hi", via: "lead", channel: "Messenger" });
    const src = captureBody().find((f: { Attribute: string }) => f.Attribute === "Source");
    expect(src.Value).toBe("Messenger");
  });

  it("stamps an Instagram channel's configured source on a NEW lead", async () => {
    stubNewLead();
    await pushIgActivity({ igUserId: "ig123", phone: "+919000000012", direction: "inbound", body: "hi", via: "lead", source: "ig-ads" });
    const src = captureBody().find((f: { Attribute: string }) => f.Attribute === "Source");
    expect(src.Value).toBe("ig-ads");
  });
});
