import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { memdb } from "./helpers/memdb";

// Consent and opt-out: what a visitor or customer said no to stays no.
//  - nothing optional (Google Analytics, the affiliate cookie, the chat
//    widget's storage) runs before the visitor agrees;
//  - product news goes only to people who didn't decline it, with a working
//    unsubscribe in every copy;
//  - a person's unsubscribe from the digest is theirs alone and survives an
//    admin switching the digest back on;
//  - marketing mail never goes to an address that bounced or complained.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("consent helpers", async () => {
  const { parseConsent, sharedCookieDomain, readCookie, cookieString, cleanRef } = await import("../consent");

  it("knows only the two answers", () => {
    expect(parseConsent("all")).toBe("all");
    expect(parseConsent("essential")).toBe("essential");
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
  });

  it("shares the answer across the marketing site and the app, nowhere else", () => {
    expect(sharedCookieDomain("app.thetalko.in", "thetalko.in")).toBe(".thetalko.in");
    expect(sharedCookieDomain("www.thetalko.in", "www.thetalko.in")).toBe(".thetalko.in");
    expect(sharedCookieDomain("thetalko.in:443", "thetalko.in")).toBe(".thetalko.in");
    expect(sharedCookieDomain("localhost:3000", "thetalko.in")).toBeUndefined();
    expect(sharedCookieDomain("evilthetalko.in", "thetalko.in")).toBeUndefined();
    expect(sharedCookieDomain("partner.example.com", undefined)).toBeUndefined();
  });

  it("reads and writes cookies", () => {
    expect(readCookie("a=1; talko_consent=all; b=2", "talko_consent")).toBe("all");
    expect(readCookie("a=1", "talko_consent")).toBeNull();
    expect(cookieString("talko_consent", "all", { maxAge: 60, domain: ".thetalko.in", secure: true }))
      .toBe("talko_consent=all; Path=/; Max-Age=60; SameSite=Lax; Domain=.thetalko.in; Secure");
  });

  it("accepts only plain affiliate codes", () => {
    expect(cleanRef(" PRIYA25 ")).toBe("PRIYA25");
    expect(cleanRef("a;b")).toBeNull();
    expect(cleanRef("")).toBeNull();
  });
});

describe("Vercel analytics addresses", async () => {
  const { redactUrl } = await import("../analytics");
  it("drops query strings and ids, keeps readable routes", () => {
    expect(redactUrl("https://app.thetalko.in/admin/conversations/3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f?tab=x&email=a@b.co"))
      .toBe("https://app.thetalko.in/admin/conversations/:id");
    expect(redactUrl("/r/rv/123456789")).toBe("/r/rv/:id");
    expect(redactUrl("/api/widget/wc_2a942b232e74027a2e65f351116f6c8d/loader.js")).toBe("/api/widget/:id/loader.js");
    expect(redactUrl("https://thetalko.in/blog/whatsapp-business-api-2026-guide")).toBe("https://thetalko.in/blog/whatsapp-business-api-2026-guide");
    expect(redactUrl("/signup?ref=PRIYA25&plan=Growth")).toBe("/signup");
  });
});

describe("nothing optional before consent (source guards)", () => {
  it("Google Analytics renders no script until the visitor accepts", () => {
    const src = read("src/components/GoogleAnalytics.tsx");
    expect(src).toMatch(/if \(!GA_ID \|\| !allowed\) return null;/);
    expect(src).toMatch(/currentConsent\(\) === "all"/);
  });

  it("the banner offers Accept and Reject with the same weight, nothing pre-chosen", () => {
    const src = read("src/components/ConsentBanner.tsx");
    const buttons = [...src.matchAll(/<button type="button" onClick=\{\(\) => pick\("(all|essential)"\)\} className="([^"]+)"/g)];
    expect(buttons.map(b => b[1]).sort()).toEqual(["all", "essential"]);
    expect(buttons[0][2]).toBe(buttons[1][2]);
  });

  it("both GA mount points also mount the banner, and /admin has neither", () => {
    for (const f of ["src/app/(site)/layout.tsx", "src/app/signup/layout.tsx"]) {
      expect(read(f)).toContain("<ConsentBanner />");
    }
    expect(read("src/app/layout.tsx")).not.toContain("GoogleAnalytics");
  });

  it("the affiliate cookie is set only with consent", () => {
    const src = read("src/middleware.ts");
    expect(src).toMatch(/parseConsent\(req\.cookies\.get\(CONSENT_COOKIE\)\?\.value\) !== "all"\) return res;/);
    expect(src).not.toMatch(/withRef\([^)]*, ref\);/);
  });

  it("the chat widget writes to storage only from its keep functions", () => {
    const src = read("src/app/api/widget/[siteKey]/loader.js/route.ts");
    const writes = src.split("\n").filter(l => l.includes("localStorage.setItem"));
    expect(writes).toHaveLength(2);
    expect(writes.every(l => /function keep(Utm|Visitor)\(\)/.test(l))).toBe(true);
    expect(src).toContain("keepVisitor(); input.value=''");
  });

  it("the Facebook SDK doesn't log app events on its own", () => {
    expect(read("src/lib/embedded-signup-client.ts")).toContain("autoLogAppEvents: false");
  });

  it("signup: product news is a separate unticked box, and GA gets only the plan", () => {
    const src = read("src/app/signup/page.tsx");
    expect(src).toContain("const [news, setNews] = useState(false);");
    expect(src).toContain("const [accept, setAccept] = useState(false);");
    expect(src).toContain('track("sign_up_start", { plan: plan() });');
    expect(src).toContain("18 or older");
  });
});

describe("unsubscribe links per person", () => {
  const SECRET = "a".repeat(32);
  const ORIGINAL = process.env.ADMIN_JWT_SECRET;
  afterEach(() => { if (ORIGINAL === undefined) delete process.env.ADMIN_JWT_SECRET; else process.env.ADMIN_JWT_SECRET = ORIGINAL; });

  async function load() {
    vi.resetModules();
    const settings: Record<string, unknown> = {};
    vi.doMock("../store", () => ({
      getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}|${k}` in settings ? settings[`${t}|${k}`] : d),
      setTenantSetting: async (t: string, k: string, v: unknown) => { settings[`${t}|${k}`] = v; },
    }));
    return { prefs: await import("../emailprefs"), settings };
  }
  const tokenFrom = (url: string) => new URL(url).searchParams.get("t") ?? "";

  it("a recipient's link opts out only that recipient, and can't be edited to another", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const { prefs } = await load();
    const token = tokenFrom(prefs.unsubscribeUrl("t1", "daily_digest", "Admin@One.co"));
    const claim = prefs.verifyUnsubscribeToken(token);
    expect(claim).toEqual({ tenantId: "t1", kind: "daily_digest", recipient: "admin@one.co" });
    const [a, k, , sig] = token.split(".");
    expect(prefs.verifyUnsubscribeToken([a, k, Buffer.from("boss@one.co").toString("base64url"), sig].join("."))).toBeNull();

    await prefs.setUnsubscribed("t1", "daily_digest", true, claim!.recipient);
    expect(await prefs.isUnsubscribed("t1", "daily_digest", "admin@one.co")).toBe(true);
    expect(await prefs.isUnsubscribed("t1", "daily_digest", "owner@one.co")).toBe(false);
    expect(await prefs.isUnsubscribed("t1", "daily_digest")).toBe(false);
  });

  it("older workspace-wide links still work", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const { prefs } = await load();
    const claim = prefs.verifyUnsubscribeToken(tokenFrom(prefs.unsubscribeUrl("t1", "product_news")));
    expect(claim).toEqual({ tenantId: "t1", kind: "product_news" });
  });
});

describe("owner broadcasts honour product-news opt-outs", () => {
  it("leaves out every workspace whose owner declined or unsubscribed — by address", async () => {
    vi.resetModules();
    const m = memdb();
    m.tables.tenants = [
      { id: "a", owner_email: "yes@x.co", company: "A", owner_name: "A", status: "active", payment_status: "active" },
      { id: "b", owner_email: "no@x.co", company: "B", owner_name: "B", status: "active", payment_status: "active" },
      // Same owner as b, in a workspace where they never opted out.
      { id: "c", owner_email: "NO@x.co", company: "C", owner_name: "C", status: "active", payment_status: "active" },
    ];
    m.tables.wa_settings = [{ tenant_id: "b", key: "email_optout:product_news", value: true }];
    vi.doMock("../supabase", () => ({ db: () => m.client }));
    const { resolveAudience } = await import("../ownerbroadcast");
    expect((await resolveAudience("all")).map(r => r.email)).toEqual(["yes@x.co"]);
  });
});

describe("bounce and complaint suppression", () => {
  it("doesn't send marketing or digests to an address that bounced or complained; account mail still goes", async () => {
    vi.resetModules();
    const m = memdb();
    m.tables.wa_email_log = [{ to_email: "gone@x.co", status: "bounced" }, { to_email: "angry@x.co", status: "complained" }];
    const sends: string[] = [];
    vi.doMock("../supabase", () => ({ db: () => m.client }));
    vi.doMock("resend", () => ({ Resend: class { emails = { send: async (o: { to: string }) => { sends.push(o.to); return { data: { id: "r1" }, error: null }; } }; } }));
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test";
    const { sendEmail } = await import("../email");
    const base = { subject: "s", html: "<p>h</p>" };
    expect((await sendEmail({ ...base, to: "gone@x.co", type: "owner_broadcast" })).ok).toBe(false);
    expect((await sendEmail({ ...base, to: "angry@x.co", type: "daily_digest" })).ok).toBe(false);
    expect((await sendEmail({ ...base, to: "gone@x.co", type: "otp" })).ok).toBe(true);
    expect((await sendEmail({ ...base, to: "fine@x.co", type: "weekly_recap" })).ok).toBe(true);
    expect(sends).toEqual(["gone@x.co", "fine@x.co"]);
  });
});
