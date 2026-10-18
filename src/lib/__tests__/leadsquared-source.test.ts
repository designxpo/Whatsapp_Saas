import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushWaActivity, pushChatActivity, pushIgActivity, syncLeadProfile, plausiblePhone } from "../leadsquared";

// Fake/typo numbers that reach CRM auto-create (web-chat visitors type junk).
// LeadSquared rejects them as invalid → the push retries to DEAD and reddens the
// health card. plausiblePhone gates them so they're a clean no-op, not a queue.
describe("plausiblePhone", () => {
  it("rejects the junk that turned the sync queue red", () => {
    expect(plausiblePhone("0000000000")).toBe(false);   // the real culprit
    expect(plausiblePhone("1111111111")).toBe(false);
    expect(plausiblePhone("12345")).toBe(false);          // too short
    expect(plausiblePhone("0999999999")).toBe(false);     // national number leading 0
    expect(plausiblePhone("")).toBe(false);
    expect(plausiblePhone(null)).toBe(false);
  });
  it("accepts real numbers (with or without country code)", () => {
    expect(plausiblePhone("9999730196")).toBe(true);
    expect(plausiblePhone("919999730196")).toBe(true);
    expect(plausiblePhone("+91 99997-30196")).toBe(true);
  });
});

// Ad-origin attribution: a WhatsApp chat opened from a paid-ad tracked link
// (Handle Hub [ref:CODE]) must create its CRM lead under that source's label
// (e.g. "ppc-whatsapp") — not the generic "WhatsApp" — so the marketing
// dashboard's ppc-whatsapp row stops reading 0. Organic chats stay "WhatsApp",
// and an EXISTING lead's source is never overwritten.
describe("pushWaActivity lead source attribution", () => {
  const calls: { url: string; body?: string }[] = [];
  // No existing lead → RetrieveLeadByPhoneNumber returns []; Lead.Capture succeeds.
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
    // Auto-creating CRM leads is OPT-IN in this product (a tenant chooses it; wab defaults it ON).
    process.env.LSQ_AUTOCREATE_LEADS = "true";
  });
  afterEach(() => vi.unstubAllGlobals());

  const captureBody = () => JSON.parse(calls.find(c => c.url.includes("Lead.Capture"))!.body!);

  it("stamps the ad source on a NEW lead when one is supplied", async () => {
    stubNewLead();
    await pushWaActivity({ phone: "+919000000001", direction: "inbound", body: "hi", via: "lead", source: "ppc-whatsapp" });
    expect(captureBody()).toContainEqual({ Attribute: "Source", Value: "ppc-whatsapp" });
  });

  it("defaults a NEW lead to \"WhatsApp\" when no source is supplied (organic)", async () => {
    stubNewLead();
    await pushWaActivity({ phone: "+919000000002", direction: "inbound", body: "hi", via: "lead" });
    expect(captureBody()).toContainEqual({ Attribute: "Source", Value: "WhatsApp" });
  });

  it("never creates (or re-sources) when the lead already exists", async () => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: { body?: string }) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("RetrieveLeadByPhoneNumber")) return { ok: true, json: async () => [{ ProspectID: "EXIST" }] } as unknown as Response;
      return { ok: true, json: async () => ({ Status: "Success" }), text: async () => "" } as unknown as Response;
    }));
    await pushWaActivity({ phone: "+919000000003", direction: "inbound", body: "hi", via: "lead", source: "ppc-whatsapp" });
    expect(calls.find(c => c.url.includes("Lead.Capture"))).toBeFalsy();   // source untouched
    // The message itself is buffered (wa_crm_session, see
    // leadsquared-session-batching.test.ts) and combined into one activity by
    // flushCrmSessions — it no longer posts to LSQ directly here.
  });

  it("sends the 10-digit NATIONAL number so LSQ's +91 prefix doesn't duplicate", async () => {
    stubNewLead();
    await pushWaActivity({ phone: "919000000009", direction: "inbound", body: "hi", via: "lead" });
    const body = captureBody();
    // "919000000009" (91 + 10 digits) → "9000000009"; LSQ then formats "+91-9000000009".
    expect(body).toContainEqual({ Attribute: "Phone", Value: "9000000009" });
    expect(body).toContainEqual({ Attribute: "Mobile", Value: "9000000009" });
    expect(JSON.stringify(body)).not.toContain("919000000009");   // never the duplicate-91 form
  });

  it("names a NEW lead from the WhatsApp profile name instead of leaving it blank", async () => {
    stubNewLead();
    await pushWaActivity({ phone: "+919000000004", direction: "inbound", body: "hi", via: "lead", name: "Tanvvi Rao" });
    const body = captureBody();
    expect(body).toContainEqual({ Attribute: "FirstName", Value: "Tanvvi" });
    expect(body).toContainEqual({ Attribute: "LastName", Value: "Rao" });
  });

  it("strips zero-width paste artifacts from the Source (so ppc filters match)", async () => {
    stubNewLead();
    await pushWaActivity({ phone: "+919000000005", direction: "inbound", body: "hi", via: "lead", source: "⁠PPC-Whatsapp" });
    const src = captureBody().find((f: { Attribute: string }) => f.Attribute === "Source");
    expect(src.Value).toBe("PPC-Whatsapp");   // U+2060 gone
  });
});

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
    // Auto-creating CRM leads is OPT-IN in this product (a tenant chooses it; wab defaults it ON).
    process.env.LSQ_AUTOCREATE_LEADS = "true";
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

// syncLeadProfile backfills the name onto an existing UNNAMED lead (the flow
// captured "Tanvvi" but the CRM showed "No Name"), and never clobbers a name a
// salesperson/PPC already set.
describe("syncLeadProfile name backfill", () => {
  const calls: { url: string; body?: string }[] = [];
  function stub(existing: Record<string, unknown>) {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: { body?: string }) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("RetrieveLeadByPhoneNumber")) return { ok: true, json: async () => [existing] } as unknown as Response;
      return { ok: true, json: async () => ({ Status: "Success" }), text: async () => "" } as unknown as Response;
    }));
  }
  beforeEach(() => {
    process.env.LSQ_ACCESS_KEY = "ak"; process.env.LSQ_SECRET_KEY = "sk";
    process.env.LSQ_API_HOST = "https://api-test.leadsquared.com"; process.env.LSQ_ACTIVITY_CODE = "210";
  });
  afterEach(() => vi.unstubAllGlobals());
  const updateBody = () => JSON.parse(calls.find(c => c.url.includes("Lead.Update"))!.body!);

  it("writes FirstName/LastName when the existing lead is unnamed", async () => {
    stub({ ProspectID: "L1", FirstName: null, LastName: null });
    await syncLeadProfile({ phone: "+919000000006", name: "Tanvvi Rao" });
    expect(updateBody()).toContainEqual({ Attribute: "FirstName", Value: "Tanvvi" });
    expect(updateBody()).toContainEqual({ Attribute: "LastName", Value: "Rao" });
  });

  it("leaves an already-named lead's name alone (no Lead.Update at all)", async () => {
    stub({ ProspectID: "L2", FirstName: "Rahul", LastName: "Sharma" });
    await syncLeadProfile({ phone: "+919000000007", name: "Tanvvi" });
    expect(calls.find(c => c.url.includes("Lead.Update"))).toBeFalsy();
  });
});
