// White-label, Phase 5: a partner's own Meta app. What must hold: nothing
// changes while white-label is off or for a workspace without a partner app;
// a partner app's webhooks are verified with that app's secret only, and reach
// only that partner's own workspaces (the partner holds the secret, so it could
// sign anything); WhatsApp never goes through a partner app.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Call = { table: string; filters: [string, unknown][] };
const calls: Call[] = [];
let rows: Record<string, (filters: [string, unknown][]) => unknown> = {};

function builder(table: string) {
  const c: Call = { table, filters: [] };
  calls.push(c);
  const b: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
  for (const m of ["select", "neq", "update"]) b[m] = chain(() => {});
  b.eq = chain((col, v) => c.filters.push([col as string, v]));
  b.maybeSingle = () => Promise.resolve({ data: rows[table]?.(c.filters) ?? null, error: null });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return b;
}
vi.mock("../supabase", () => ({ db: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("../crypto", () => ({ readSecret: (v: string | null) => v, encryptSecret: (v: string) => v }));
vi.mock("../email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { verifyPartnerWebhook, partnerVerifyTokenOk, partnerScope, metaCredsForTenant, metaAppProblems, partnerWebhookUrl, partnerMetaSetup } from "../partner-meta";
import { igAuthorizeUrl, igRedirectUri } from "../iglogin";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const APP = { appId: "1234567890", appSecretEnc: "fb-secret", igAppId: "9876543210", igAppSecretEnc: "ig-secret", verifyToken: "verify-me", active: true };
const sign = (raw: string, secret: string) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  calls.length = 0;
  rows = {
    wa_partners: f => (f.some(([k, v]) => k === "id" && v === P1) ? { meta_app: APP } : null),
    tenants: f => {
      const id = f.find(([k]) => k === "id")?.[1];
      return id === "t-mine" ? { partner_id: P1 } : id === "t-theirs" ? { partner_id: P2 } : id === "t-talko" ? { partner_id: null } : null;
    },
  };
  vi.stubEnv("WHITE_LABEL_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("while white-label is off", () => {
  it("no partner app is used, and nothing is read", async () => {
    vi.stubEnv("WHITE_LABEL_ENABLED", "");
    const raw = "{}";
    expect(await verifyPartnerWebhook(P1, raw, sign(raw, "fb-secret"), "messenger")).toBe(false);
    expect(await partnerVerifyTokenOk(P1, "verify-me")).toBe(false);
    expect(await metaCredsForTenant("t-mine")).toBeNull();
    expect(calls.length).toBe(0);
  });
});

describe("a partner app's webhook signature", () => {
  const raw = JSON.stringify({ object: "page", entry: [{ id: "123" }] });
  it("passes with that app's secret", async () => {
    expect(await verifyPartnerWebhook(P1, raw, sign(raw, "fb-secret"), "messenger")).toBe(true);
  });
  it("fails with Talko's or anyone else's secret", async () => {
    vi.stubEnv("META_APP_SECRET", "talko-secret");
    expect(await verifyPartnerWebhook(P1, raw, sign(raw, "talko-secret"), "messenger")).toBe(false);
    expect(await verifyPartnerWebhook(P1, raw, null, "messenger")).toBe(false);
  });
  it("Instagram accepts the partner's Instagram app secret; Pages don't", async () => {
    expect(await verifyPartnerWebhook(P1, raw, sign(raw, "ig-secret"), "instagram")).toBe(true);
    expect(await verifyPartnerWebhook(P1, raw, sign(raw, "ig-secret"), "messenger")).toBe(false);
  });
  it("fails for a partner without an app, and for a malformed id, before reading", async () => {
    expect(await verifyPartnerWebhook(P2, raw, sign(raw, "fb-secret"), "messenger")).toBe(false);
    calls.length = 0;
    expect(await verifyPartnerWebhook("../evil", raw, sign(raw, "fb-secret"), "messenger")).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe("the subscribe handshake", () => {
  it("needs this partner's own verify token", async () => {
    expect(await partnerVerifyTokenOk(P1, "verify-me")).toBe(true);
    expect(await partnerVerifyTokenOk(P1, "verify-mf")).toBe(false);
    expect(await partnerVerifyTokenOk(P1, null)).toBe(false);
    expect(await partnerVerifyTokenOk(P2, "verify-me")).toBe(false);
  });
});

describe("a partner app's events reach only its own workspaces", () => {
  it("its own workspace yes; another partner's or Talko's own, no", async () => {
    const inScope = partnerScope(P1);
    expect(await inScope("t-mine")).toBe(true);
    expect(await inScope("t-theirs")).toBe(false);
    expect(await inScope("t-talko")).toBe(false);
    expect(await inScope("t-missing")).toBe(false);
  });
  it("asks once per workspace per webhook call", async () => {
    const inScope = partnerScope(P1);
    await inScope("t-mine"); await inScope("t-mine");
    expect(calls.filter(c => c.table === "tenants").length).toBe(1);
  });
  it("both partner-capable webhooks drop out-of-scope channels before handling anything", () => {
    for (const f of ["instagram", "messenger"]) {
      const src = read(`src/app/api/webhooks/${f}/route.ts`);
      expect(src).toMatch(/const scope = partnerApp \? partnerScope\(partnerApp\) : null;/);
      expect(src).toMatch(/const channel = found && scope && !\(await scope\(found\.tenantId\)\) \? null : found;/);
    }
  });
  it("WhatsApp never takes a partner app's events (its receipts and number health can't be fenced)", () => {
    const src = read("src/app/api/webhooks/whatsapp/route.ts");
    expect(src).not.toMatch(/partner-meta|searchParams\.get\("app"\)/);
  });
});

describe("which app a workspace connects through", () => {
  it("the partner's, only when that partner's app is switched on", async () => {
    expect(await metaCredsForTenant("t-mine")).toMatchObject({ partnerId: P1, appId: "1234567890", appSecret: "fb-secret", igAppId: "9876543210", igAppSecret: "ig-secret" });
    rows.wa_partners = () => ({ meta_app: { ...APP, active: false } });
    expect(await metaCredsForTenant("t-mine")).toBeNull();
  });
  it("Talko's for a workspace without a partner", async () => {
    expect(await metaCredsForTenant("t-talko")).toBeNull();
    expect(await metaCredsForTenant(null)).toBeNull();
  });
  it("Talko's Instagram app, unchanged, when no partner app is passed", () => {
    vi.stubEnv("META_INSTAGRAM_APP_ID", "555000555");
    vi.stubEnv("META_INSTAGRAM_REDIRECT_URI", "https://app.thetalko.in/api/admin/onboarding/instagram/callback");
    vi.stubEnv("NEXT_PUBLIC_APP_HOST", "app.thetalko.in");
    const talko = "https://app.thetalko.in/api/admin/onboarding/instagram/start";
    expect(igRedirectUri(talko)).toBe("https://app.thetalko.in/api/admin/onboarding/instagram/callback");
    expect(new URL(igAuthorizeUrl(igRedirectUri(talko), "s")).searchParams.get("client_id")).toBe("555000555");
    // Started on a partner's address, it comes back there, where the customer is signed in.
    const req = "https://brightdental.thetalko.in/api/admin/onboarding/instagram/start";
    expect(igRedirectUri(req)).toBe("https://brightdental.thetalko.in/api/admin/onboarding/instagram/callback");
    vi.stubEnv("WHITE_LABEL_ENABLED", "");
    expect(igRedirectUri(req)).toBe("https://app.thetalko.in/api/admin/onboarding/instagram/callback");   // white-label off: exactly as before
    vi.stubEnv("WHITE_LABEL_ENABLED", "1");
    // A partner's app returns to the partner's own address with its own id.
    const app = { appId: "9876543210", appSecret: "x" };
    expect(igRedirectUri(req, app)).toBe("https://brightdental.thetalko.in/api/admin/onboarding/instagram/callback");
    expect(new URL(igAuthorizeUrl(igRedirectUri(req, app), "s", app)).searchParams.get("client_id")).toBe("9876543210");
  });
});

describe("the daily check", () => {
  const good = [
    { object: "page", callback_url: partnerWebhookUrl(P1, "messenger"), active: true },
    { object: "instagram", callback_url: partnerWebhookUrl(P1, "instagram"), active: true },
  ];
  it("passes when the webhooks point at Talko and Talko is an admin", () => {
    expect(metaAppProblems(P1, good, [{ user: "42", role: "administrators" }], "42")).toEqual([]);
    expect(metaAppProblems(P1, good, null, null)).toEqual([]);   // admin check off
  });
  it("reports webhooks moved elsewhere, missing or off", () => {
    const moved = [{ ...good[0], callback_url: "https://elsewhere.example/hook" }, { ...good[1], active: false }];
    const p = metaAppProblems(P1, moved, null, null);
    expect(p.join(" ")).toMatch(/points somewhere else/);
    expect(p.join(" ")).toMatch(/switched off/);
    expect(metaAppProblems(P1, [good[0]], null, null).join(" ")).toMatch(/No instagram webhook/);
    expect(metaAppProblems(P1, null, null, null).join(" ")).toMatch(/didn't answer/);
  });
  it("another partner's webhook address doesn't count", () => {
    expect(metaAppProblems(P2, good, null, null).length).toBe(2);
  });
  it("reports Talko losing its admin role", () => {
    expect(metaAppProblems(P1, good, [{ user: "42", role: "developers" }], "42")).toEqual(["Talko is no longer an admin of this app."]);
  });
});

describe("what the partner allows in its app", () => {
  it("every address its portal answers on", () => {
    vi.stubEnv("PARTNER_BASE_DOMAIN", "thetalko.in");
    expect(partnerMetaSetup({ slug: "brightdental", customDomain: null })).toEqual({
      instagramRedirects: ["https://brightdental.thetalko.in/api/admin/onboarding/instagram/callback"],
      jsSdkDomains: ["brightdental.thetalko.in"],
    });
    expect(partnerMetaSetup({ slug: "brightdental", customDomain: "portal.bright.in" }).jsSdkDomains).toEqual(["brightdental.thetalko.in", "portal.bright.in"]);
  });
});
