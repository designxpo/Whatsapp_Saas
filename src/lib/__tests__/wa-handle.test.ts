import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncLeadProfile } from "../leadsquared";
import { normHandle } from "../store";

// WhatsApp @username groundwork. The CRM differentiator: when a lead's number is
// hidden, syncLeadProfile must resolve the lead by @handle (via the tenant's
// waHandleField) and stamp the handle onto the lead so future handle-only inbound
// still dedupes — no phone required.
describe("normHandle", () => {
  it("lowercases and strips leading @", () => {
    expect(normHandle("@Arman")).toBe("arman");
    expect(normHandle("  @@ArmanX ")).toBe("armanx");
    expect(normHandle("")).toBe("");
  });
});

describe("syncLeadProfile — @handle path (hidden number)", () => {
  const calls: { url: string; body?: string }[] = [];
  beforeEach(() => {
    // DEFAULT_TENANT_ID → resolveLsq falls back to env creds (no DB needed).
    process.env.LSQ_ACCESS_KEY = "ak";
    process.env.LSQ_SECRET_KEY = "sk";
    process.env.LSQ_API_HOST = "https://api-test.leadsquared.com";
    process.env.LSQ_ACTIVITY_CODE = "100";
    process.env.LSQ_WA_HANDLE_FIELD = "mx_WhatsAppHandle";
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: { body?: string }) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("Leads.Get")) {
        return { ok: true, json: async () => [{ ProspectID: "LEAD9" }] } as unknown as Response;
      }
      return { ok: true, json: async () => ({ Status: "Success" }), text: async () => "" } as unknown as Response;
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.LSQ_WA_HANDLE_FIELD; });

  it("resolves the lead by handle (waHandleField) and writes handle + email — no phone", async () => {
    await syncLeadProfile({ handle: "@arman", email: "arman@gmail.com" });
    const lookup = calls.find(c => c.url.includes("Leads.Get"));
    expect(lookup).toBeTruthy();
    expect(JSON.parse(lookup!.body!).Parameter).toMatchObject({ LookupName: "mx_WhatsAppHandle" });
    const update = calls.find(c => c.url.includes("Lead.Update"));
    expect(update!.url).toContain("leadId=LEAD9");
    const fields = JSON.parse(update!.body!);
    expect(fields).toContainEqual({ Attribute: "EmailAddress", Value: "arman@gmail.com" });
    expect(fields).toContainEqual({ Attribute: "mx_WhatsAppHandle", Value: "arman" });
  });

  it("never phone-looks-up when only a handle is known", async () => {
    await syncLeadProfile({ handle: "arman", city: "Baghpat" });
    expect(calls.find(c => c.url.includes("RetrieveLeadByPhoneNumber"))).toBeFalsy();
    expect(calls.find(c => c.url.includes("Leads.Get"))).toBeTruthy();
  });

  it("does nothing when there's no CRM-relevant field (handle only, no waHandleField)", async () => {
    delete process.env.LSQ_WA_HANDLE_FIELD;
    await syncLeadProfile({ handle: "arman" });
    expect(calls.length).toBe(0);
  });
});
