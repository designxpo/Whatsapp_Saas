// End to end, through the real code paths: the API routes, the libraries, the
// real tenant scoping (tenantdb) and the real settings/document stores — with
// only the outside world replaced: an in-memory database (helpers/memdb), and
// recorded WhatsApp sends and knowledge-base ingestion. Two workspaces are
// present in every flow, so a leak between them would show.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/memdb").MemDb,
  who: { email: "owner@talko.in", tenantId: "00000000-0000-0000-0000-000000000001", admin: true, owner: true },
  sent: [] as { phone: string; body: string }[],
  ingested: [] as { docId: string; text: string }[],
  gbp: null as null | { id: string; googleAccountId: string; googleLocationId: string },
  reviewUri: { url: "https://g.page/r/CFromGoogle/review" } as { url?: string; error?: string },
}));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../auth", () => ({
  DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  currentUser: async () => ({ email: h.who.email, name: "Owner", tenantId: h.who.tenantId }),
  currentTenantId: async () => h.who.tenantId,
  requireRoleAdmin: async () => h.who.admin,
  isPlatformOwner: async () => h.who.owner,
}));
vi.mock("../team", () => ({ logActivity: () => undefined }));
vi.mock("../googlereviews", () => ({ locationReviewUrl: vi.fn(async () => h.reviewUri) }));
vi.mock("../kb", () => ({ ingestDocument: vi.fn(async (docId: string, _t: string, p: { text: string }) => { h.ingested.push({ docId, text: p.text }); }) }));
vi.mock("../whatsapp", () => ({ sendText: vi.fn(async (phone: string, body: string) => { h.sent.push({ phone, body }); return { id: `wamid.${h.sent.length}` }; }) }));
vi.mock("../channels", () => ({
  listChannels: async (t?: string) => [
    { id: "wa1", tenantId: t, kind: "whatsapp", active: true, isDefault: true, token: "EAAreal", phoneId: "p1" },
    ...(h.gbp ? [{ ...h.gbp, tenantId: t, kind: "google_reviews", active: true, token: "refresh-gbp" }] : []),
  ],
  isLiveChannel: (c: { active: boolean; token: string }) => c.active && !!c.token,
}));

import { memdb } from "./helpers/memdb";
import { knowledgeGapReason, recordGap } from "../ai-gaps";
import { scoreLead } from "../hot-leads";
import { renderDigest } from "../dailydigest";
import { drainReviewBooster, REVIEW_BOOSTER_LIVE } from "../review-booster";
import { GET as gapsGet, POST as gapsPost } from "../../app/api/admin/ai/gaps/route";
import { GET as leadsGet } from "../../app/api/admin/hot-leads/route";
import { GET as boosterGet, POST as boosterPost } from "../../app/api/admin/review-booster/route";
import { GET as openLink } from "../../app/r/rv/[token]/route";

const T1 = "00000000-0000-0000-0000-000000000001";   // the owner's own workspace
const T2 = "22222222-2222-4222-8222-222222222222";   // a tenant
const SOFT = "Thanks for reaching out! 🙂 Could you tell me a little more about what you're looking for? I'm happy to help — or just type \"agent\" anytime to reach our team.";
const req = (url: string, body?: unknown) => new NextRequest(`https://app.thetalko.in${url}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
const flush = () => new Promise(r => setTimeout(r, 0));
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

beforeEach(() => {
  h.db = memdb({ wa_review_requests: [["token"], ["tenant_id", "order_id"]] });
  h.who = { email: "owner@talko.in", tenantId: T1, admin: true, owner: true };
  h.sent.length = 0; h.ingested.length = 0;
  h.gbp = null; h.reviewUri = { url: "https://g.page/r/CFromGoogle/review" };
});

// ── 1. Questions the AI couldn't answer ─────────────────────────────────────
describe("questions the AI couldn't answer", () => {
  it("counts a real question the knowledge base couldn't answer — not a request for a person, a greeting or an error", () => {
    expect(knowledgeGapReason({ reply: null, escalate: true, reason: "model escalated" }, "Do you ship to Dubai?", SOFT)).toBe("handed off");
    expect(knowledgeGapReason({ reply: SOFT, escalate: false, reason: "empty model reply" }, "what is the batch timing", SOFT)).toBe("asked for more detail");
    expect(knowledgeGapReason({ reply: null, escalate: true, reason: "model escalated" }, "I want to talk to a real person", SOFT)).toBeNull();
    expect(knowledgeGapReason({ reply: null, escalate: true, reason: "model escalated" }, "hi", SOFT)).toBeNull();
    expect(knowledgeGapReason({ reply: "Thanks!", escalate: false, reason: "generation error (fallback)" }, "Do you ship to Dubai?", SOFT)).toBeNull();
    expect(knowledgeGapReason({ reply: "We ship worldwide.", escalate: false }, "Do you ship to Dubai?", SOFT)).toBeNull();
  });

  it("records → lists grouped per workspace → answer goes into the knowledge base → resolved", async () => {
    recordGap({ tenantId: T1, platform: "whatsapp", question: "What are the fees?", reason: "handed off", phone: "919811111111" });
    recordGap({ tenantId: T1, platform: "instagram", question: "what are the FEES", reason: "handed off" });
    recordGap({ tenantId: T1, platform: "whatsapp", question: "Do you ship to Dubai?", reason: "asked for more detail" });
    recordGap({ tenantId: T2, platform: "whatsapp", question: "Secret question from another workspace", reason: "handed off" });
    await flush();

    const list = await json(await gapsGet(req("/api/admin/ai/gaps?days=30")));
    expect(list.status).toBe(200);
    const groups = list.body.groups as { key: string; question: string; count: number; platforms: string[] }[];
    expect(groups.map(g => [g.count, g.platforms.sort()])).toEqual([[2, ["instagram", "whatsapp"]], [1, ["whatsapp"]]]);
    expect(JSON.stringify(groups)).not.toContain("another workspace");

    // A member can't change the knowledge base.
    h.who.admin = false;
    expect((await gapsPost(req("/api/admin/ai/gaps", { key: groups[0].key, answer: "x" }))).status).toBe(403);
    h.who.admin = true;

    const ans = await json(await gapsPost(req("/api/admin/ai/gaps", { key: groups[0].key, answer: "₹4,999 a month, billed monthly.", tag: "Fees" })));
    expect(ans.status).toBe(200);
    const doc = h.db.tables.kb_documents.find(d => d.id === ans.body.docId)!;
    expect(doc).toMatchObject({ tenant_id: T1, source_type: "text", tag: "Fees" });
    // Either phrasing may be the newest (same millisecond); both are the same question.
    expect(h.ingested).toEqual([{ docId: ans.body.docId, text: expect.stringMatching(/^Question: what are the fees\??\nAnswer: ₹4,999 a month/i) }]);
    expect(h.db.tables.wa_ai_gaps.filter(g => g.question_key === groups[0].key).every(g => g.resolution === "answered" && g.kb_doc_id === ans.body.docId)).toBe(true);

    expect((await gapsPost(req("/api/admin/ai/gaps", { key: groups[1].key, dismiss: true }))).status).toBe(200);
    expect((await json(await gapsGet(req("/api/admin/ai/gaps?days=30")))).body.groups).toEqual([]);
    // The other workspace's question is untouched.
    expect(h.db.tables.wa_ai_gaps.find(g => g.tenant_id === T2)!.resolved_at).toBeUndefined();
  });

  it("is recorded from the one path every AI reply takes, except tests, simulators and drafts", () => {
    const llm = readFileSync(join(process.cwd(), "src/lib/llm.ts"), "utf8");
    expect(llm).toMatch(/if \(!opts\.practice\) \{[\s\S]*knowledgeGapReason\(result, question, SOFT_FALLBACK\)[\s\S]*recordGap\(/);
    for (const f of ["src/app/api/admin/assistant/test/route.ts", "src/app/api/admin/flows/[id]/simulate/route.ts", "src/app/api/inbox/suggest/route.ts", "src/app/api/crm/suggest/route.ts"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toMatch(/practice: true/);
    }
  });
});

// ── 2. Hot leads ────────────────────────────────────────────────────────────
describe("hot leads", () => {
  it("scores what the customer wrote and did, with the reasons", () => {
    const hot = scoreLead({ inbound: ["Hi", "kitna price hai?", "can I book a demo tomorrow"], lastInboundAt: hoursAgo(1), sharedPhone: true, waitingOnReply: true, paidRecently: false });
    expect(hot.band).toBe("hot");
    expect(hot.reasons).toEqual(expect.arrayContaining(["asked about price", "wants to book or join", "waiting on your reply"]));
    expect(scoreLead({ inbound: ["price?", "book now"], lastInboundAt: hoursAgo(1), sharedPhone: false, waitingOnReply: false, paidRecently: true }).reasons).toContain("already paid this week");
    expect(scoreLead({ inbound: ["worst service, I want a refund"], lastInboundAt: hoursAgo(1), sharedPhone: false, waitingOnReply: true, paidRecently: false }).band).not.toBe("hot");
    expect(scoreLead({ inbound: ["ok"], lastInboundAt: hoursAgo(60), sharedPhone: false, waitingOnReply: false, paidRecently: false }).band).toBe("cold");
  });

  it("ranks this workspace's chats from the database, leaving out other workspaces and recent buyers", async () => {
    const t = h.db.tables;
    t.wa_conversations = [
      { id: "c1", tenant_id: T1, phone: "919800000001", name: "Asha", platform: "whatsapp", last_inbound_at: hoursAgo(1), lead_phone: null, needs_reply: true, status: "active" },
      { id: "c2", tenant_id: T1, phone: "919800000002", name: "Ravi", platform: "instagram", last_inbound_at: hoursAgo(2), lead_phone: null, needs_reply: false, status: "active" },
      { id: "c3", tenant_id: T1, phone: "919800000003", name: "Old", platform: "whatsapp", last_inbound_at: hoursAgo(100), lead_phone: null, needs_reply: true, status: "active" },
      { id: "c9", tenant_id: T2, phone: "919800000009", name: "Other tenant", platform: "whatsapp", last_inbound_at: hoursAgo(1), lead_phone: null, needs_reply: true, status: "active" },
    ];
    t.wa_conv_messages = [
      { conversation_id: "c1", tenant_id: T1, role: "user", body: "What's the price for the course?", created_at: hoursAgo(1.2) },
      { conversation_id: "c1", tenant_id: T1, role: "user", body: "Can I book a demo?", created_at: hoursAgo(1) },
      { conversation_id: "c2", tenant_id: T1, role: "user", body: "price? I want to order", created_at: hoursAgo(2) },
      { conversation_id: "c3", tenant_id: T1, role: "user", body: "price and booking please", created_at: hoursAgo(100) },
      { conversation_id: "c9", tenant_id: T2, role: "user", body: "price? book? buy?", created_at: hoursAgo(1) },
    ];
    t.wa_orders = [{ id: "o1", tenant_id: T1, phone: "919800000002", status: "paid", total_cents: 99_900, created_at: hoursAgo(5), paid_at: hoursAgo(5) }];

    const r = await json(await leadsGet());
    expect(r.status).toBe(200);
    const names = [...r.body.hot, ...r.body.warm].map((l: { name: string }) => l.name);
    expect(names[0]).toBe("Asha");                 // price + booking + recent + waiting
    expect(names).not.toContain("Other tenant");   // another workspace
    expect(names).not.toContain("Old");            // older than three days
    expect(r.body.hot.find((l: { name: string }) => l.name === "Ravi")).toBeUndefined();   // just paid: not a hot call
  });

  it("the morning digest carries the call list and the open questions", () => {
    const mail = renderDigest({
      day: "2026-11-01", waiting: { total: 2, oldestHours: 3, byOwner: [] }, escalatedStale: 0,
      yesterday: { newLeads: 4, aiReplies: 10, escalations: 1, optOuts: 0, failedSends: 0 }, inDrips: 0,
      hotLeads: [{ name: "Asha", phoneTail: "0001", channel: "whatsapp", reasons: ["asked about price", "wants to book or join"] }],
      gaps: { open: 3, top: [{ question: "Do you ship to Dubai?", count: 4 }] },
    }, T1);
    expect(mail.text).toContain("Call these first: Asha (asked about price, wants to book or join)");
    expect(mail.text).toContain("3 questions the AI couldn't answer this week");
    expect(mail.text).toContain("Do you ship to Dubai?");
  });
});

// ── 3. Google review booster (owner preview) ───────────────────────────────
describe("google review booster — owner only until launched", () => {
  it("doesn't exist for a tenant, nor for the owner inside a tenant's workspace", async () => {
    expect(REVIEW_BOOSTER_LIVE).toBe(false);
    h.who = { email: "admin@clinic.in", tenantId: T2, admin: true, owner: false };
    expect((await boosterGet()).status).toBe(404);
    expect((await boosterPost(req("/api/admin/review-booster", { enabled: true, reviewUrl: "https://g.page/r/x/review" }))).status).toBe(404);
    h.who = { email: "owner@talko.in", tenantId: T2, admin: true, owner: true };
    expect((await boosterGet()).status).toBe(404);
  });

  it("paid order → WhatsApp request with a tracked link → opened → counted, once per order", async () => {
    expect((await boosterPost(req("/api/admin/review-booster", { enabled: true, reviewUrl: "https://example.com/review" }))).status).toBe(400);
    const saved = await json(await boosterPost(req("/api/admin/review-booster", { enabled: true, reviewUrl: "https://g.page/r/CTalko/review", delayHours: 2 })));
    expect(saved.status).toBe(200);

    const t = h.db.tables;
    t.wa_conversations = [
      { id: "c1", tenant_id: T1, phone: "919800000001", platform: "whatsapp", last_inbound_at: hoursAgo(1) },
      { id: "c2", tenant_id: T1, phone: "919800000002", platform: "whatsapp", last_inbound_at: hoursAgo(30) },
    ];
    t.wa_orders = [
      { id: "11111111-1111-4111-8111-000000000001", tenant_id: T1, phone: "919800000001", status: "paid", paid_at: hoursAgo(3), created_at: hoursAgo(3) },
      { id: "11111111-1111-4111-8111-000000000002", tenant_id: T1, phone: "919800000002", status: "paid", paid_at: hoursAgo(3), created_at: hoursAgo(3) },
      { id: "11111111-1111-4111-8111-000000000003", tenant_id: T1, phone: "919800000001", status: "paid", paid_at: hoursAgo(1), created_at: hoursAgo(1) },   // inside the 2h delay
      { id: "11111111-1111-4111-8111-000000000009", tenant_id: T2, phone: "919800000009", status: "paid", paid_at: hoursAgo(3), created_at: hoursAgo(3) },   // a tenant: not live
    ];
    t.wa_settings ??= [];
    t.wa_settings.push({ tenant_id: T2, key: "review_booster", value: { enabled: true, reviewUrl: "https://g.page/r/x/review", message: "x", delayHours: 0 } });

    expect(await drainReviewBooster()).toEqual({ asked: 1 });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].phone).toBe("919800000001");
    const token = (h.sent[0].body.match(/\/r\/rv\/([a-z0-9]{12})/) ?? [])[1];
    expect(token).toBeTruthy();
    expect(h.sent[0].body).toMatch(/Something not right\? Just reply here/);   // offered to everyone, alongside — no gating
    expect(t.wa_review_requests.find(r => r.phone === "919800000002")).toMatchObject({ status: "skipped", detail: expect.stringMatching(/24-hour window/) });
    expect(t.wa_review_requests.some(r => r.tenant_id === T2)).toBe(false);

    // Once per order: the next run asks no one again.
    expect(await drainReviewBooster()).toEqual({ asked: 0 });
    expect(h.sent).toHaveLength(1);

    // The customer opens the link → counted → sent on to Google.
    const open = await openLink(new Request(`https://app.thetalko.in/r/rv/${token}`), { params: Promise.resolve({ token }) });
    expect(open.status).toBe(302);
    expect(open.headers.get("location")).toBe("https://g.page/r/CTalko/review");
    expect((await openLink(new Request("https://app.thetalko.in/r/rv/zzzzzzzzzzzz"), { params: Promise.resolve({ token: "zzzzzzzzzzzz" }) })).status).toBe(404);

    const stats = (await json(await boosterGet())).body.stats;
    expect(stats).toMatchObject({ sent: 1, opened: 1, skipped: 1, failed: 0 });
  });

  it("the owner can ask one customer now, and only inside the 24-hour window", async () => {
    await boosterPost(req("/api/admin/review-booster", { reviewUrl: "https://g.page/r/CTalko/review" }));
    h.db.tables.wa_conversations = [{ id: "c1", tenant_id: T1, phone: "919800000001", platform: "whatsapp", last_inbound_at: hoursAgo(2) }];
    expect((await json(await boosterPost(req("/api/admin/review-booster", { sendTo: "+91 98000 00001" })))).body).toEqual({ status: "sent" });
    expect((await json(await boosterPost(req("/api/admin/review-booster", { sendTo: "919800000777" })))).body.status).toBe("skipped");
  });

  it("accepts Google's share.google links, and a number typed without the country code", async () => {
    const saved = await json(await boosterPost(req("/api/admin/review-booster", { reviewUrl: "https://share.google/ZBbNt32G4TQlio5xh" })));
    expect(saved.status).toBe(200);
    expect(saved.body.config.reviewUrl).toBe("https://share.google/ZBbNt32G4TQlio5xh");
    h.db.tables.wa_conversations = [{ id: "c1", tenant_id: T1, phone: "918368872108", platform: "whatsapp", last_inbound_at: hoursAgo(1) }];
    expect((await json(await boosterPost(req("/api/admin/review-booster", { sendTo: "8368872108" })))).body).toEqual({ status: "sent" });
    expect(h.sent[0].phone).toBe("918368872108");
    // The request shows in the customer's chat, sent from the business number.
    expect(h.db.tables.wa_conv_messages).toEqual([expect.objectContaining({ tenant_id: T1, conversation_id: "c1", role: "assistant", source: "bot", body: h.sent[0].body, meta_message_id: "wamid.1" })]);
    expect((await boosterPost(req("/api/admin/review-booster", { sendTo: "12345" }))).status).toBe(400);
  });

  it("fills the review link from the connected Google Business Profile", async () => {
    expect((await json(await boosterGet())).body.googleConnected).toBe(false);
    expect((await boosterPost(req("/api/admin/review-booster", { fromGoogle: true }))).status).toBe(400);
    h.gbp = { id: "gbp1", googleAccountId: "accounts/1", googleLocationId: "locations/1" };
    expect((await json(await boosterGet())).body.googleConnected).toBe(true);
    const filled = await json(await boosterPost(req("/api/admin/review-booster", { fromGoogle: true })));
    expect(filled.body.config.reviewUrl).toBe("https://g.page/r/CFromGoogle/review");
    h.reviewUri = { error: "Google refused access" };
    expect((await json(await boosterPost(req("/api/admin/review-booster", { fromGoogle: true })))).body.error).toBe("Google refused access");
  });

  it("is not on the website or any tenant screen: the section renders only when its API answers", () => {
    const ui = readFileSync(join(process.cwd(), "src/app/admin/_tabs/ReviewBooster.tsx"), "utf8");
    expect(ui).toMatch(/if \(!r\?\.ok\) \{ setHidden\(true\); return; \}/);
    expect(ui).toMatch(/if \(hidden \|\| !cfg\) return null;/);
  });
});
