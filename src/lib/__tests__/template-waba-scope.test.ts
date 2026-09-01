// A template belongs to ONE WhatsApp Business Account, and a broadcast naming a
// template the sending number's account has never heard of reports as sent and
// arrives nowhere.
//
// Preflight already existed here — and had exactly this hole. fetchTemplateByName
// returned a bare `null` for two situations needing opposite handling:
//
//   • we could not CHECK (missing creds, Meta unreachable) — must not block
//   • the template is genuinely NOT on this account          — must block
//
// The caller guarded with `if (tpl)`, so the second case skipped validation
// entirely. Meta then accepts the broadcast and rejects every message with
// (#132001) during the queue drain, minutes after the composer said "Sent to N
// recipients." A second version of the same bug lived in the language fallback
// (`?? tpls.find(t => t.name === name)`): a template present only in `hi`
// satisfied a request for `en_US`.
//
// These tests exist to keep those three outcomes distinguishable, because they
// are three different fixes that Meta reports near-identically.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  templates: [] as { name: string; status: string; language: string; category: string; components: unknown[] }[],
  fetchThrows: null as Error | null,
  created: [] as Record<string, unknown>[],
  started: 0,
}));

const tpl = (name: string, language = "en_US", status = "APPROVED") =>
  ({ name, language, status, category: "MARKETING", components: [{ type: "BODY", text: "Hello" }] });

vi.mock("../whatsapp", () => ({
  fetchTemplates: async () => {
    if (h.fetchThrows) throw h.fetchThrows;
    return h.templates;
  },
}));
vi.mock("../channels", () => ({
  credsFor: async () => ({ token: "tok", phoneId: "phone", wabaId: "waba" }),
  getChannel: async () => null,
}));
vi.mock("../store", () => ({
  createCampaign: async (c: Record<string, unknown>) => { h.created.push(c); return { id: "c1", ...c }; },
  getCampaign: async () => null,
  recipientsForAudience: async () => [{ phone: "919876543210", fullName: "A" }],
}));
vi.mock("../campaign", () => ({
  startSend: async () => { h.started++; return { status: "sending", sentNow: 1, queuedRemaining: 0, message: "Sent to 1 recipient." }; },
}));
vi.mock("../moderation", () => ({ assertImageAllowed: async () => undefined }));

beforeEach(() => {
  h.templates = [];
  h.fetchThrows = null;
  h.created.length = 0;
  h.started = 0;
});

async function run(templateName: string, languageCode = "en_US") {
  const { runBroadcast } = await import("../broadcast");
  return runBroadcast({ mode: "audience", templateName, languageCode, audience: { mode: "all" } } as never);
}

describe("broadcast template preflight", () => {
  it("refuses a template that isn't on this number's account, and creates nothing", async () => {
    h.templates = [tpl("course_welcome"), tpl("webinar_update")];
    await expect(run("offer_independence_day")).rejects.toThrow(/doesn't exist on this number/i);
    // The entire point of checking before createCampaign rather than in the drain.
    expect(h.created).toEqual([]);
    expect(h.started).toBe(0);
  });

  it("names what IS approved there, so the fix needs no second screen", async () => {
    h.templates = [tpl("course_welcome")];
    await expect(run("offer_independence_day")).rejects.toThrow(/course_welcome/);
  });

  it("refuses a wrong LANGUAGE instead of silently substituting one", async () => {
    // The old `?? tpls.find(t => t.name === name)` fallback accepted this.
    h.templates = [tpl("course_welcome", "hi")];
    await expect(run("course_welcome", "en_US")).rejects.toThrow(/not in en_US/);
    expect(h.created).toEqual([]);
  });

  it("refuses a template that exists but is not approved", async () => {
    h.templates = [tpl("course_welcome", "en_US", "PENDING")];
    await expect(run("course_welcome")).rejects.toThrow(/approved/i);
    expect(h.started).toBe(0);
  });

  it("lets a valid template straight through", async () => {
    h.templates = [tpl("course_welcome")];
    const r = await run("course_welcome");
    expect(r.success).toBe(true);
    expect(h.started).toBe(1);
  });

  it("still sends when the CHECK itself fails", async () => {
    // Not being able to verify a template is not evidence the template is wrong,
    // and a guard that cannot run must not become an outage.
    h.fetchThrows = new Error("Meta unreachable");
    const r = await run("course_welcome");
    expect(r.success).toBe(true);
    expect(h.started).toBe(1);
  });
});
