// WhatsApp handoff: a comment or DM continues on WhatsApp with its context.
// What must hold: a code is recognised in both forms (hidden in a link's
// message, typed on YouTube) and never mistaken for Handle Hub's own codes; a
// claim happens only in the workspace that owns the number, once, unexpired;
// YouTube invitations carry no link or number; the DM keeps Meta's 3-button
// cap; a failed handoff never blocks the DM; sales count only paid orders
// placed after the chat started.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Q = { table: string; op: string; filters: [string, ...unknown[]][]; payload?: unknown };
const qs: Q[] = [];
let insertErrors: ({ code: string; message: string } | null)[] = [];
let claimRow: Record<string, unknown> | null = null;
let orderRows: Record<string, unknown>[] = [];
let entryPoints: { number: string; greeting: string }[] = [];
let handoffRows: Record<string, unknown>[] = [];

function builder(table: string) {
  const q: Q = { table, op: "select", filters: [] };
  qs.push(q);
  const b: Record<string, unknown> = {};
  const rec = (name: string) => (...a: unknown[]) => { q.filters.push([name, ...a]); return b; };
  for (const m of ["select", "eq", "is", "gt", "gte", "in", "order", "limit", "not", "or"]) b[m] = rec(m);
  b.update = (p: unknown) => { q.op = "update"; q.payload = p; return b; };
  b.insert = (p: unknown) => { q.op = "insert"; q.payload = p; return b; };
  b.maybeSingle = async () => {
    if (q.op === "insert") { const e = insertErrors.shift() ?? null; return e ? { data: null, error: e } : { data: { id: "h1", ...(q.payload as object), created_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }, error: null }; }
    if (q.op === "update") return { data: claimRow, error: null };
    return { data: null, error: null };
  };
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "wa_orders" ? orderRows : table === "wa_handoffs" ? handoffRows : [], count: handoffRows.length, error: null }).then(res);
  return b;
}
vi.mock("../supabase", () => ({ db: () => ({ from: builder }) }));
vi.mock("../tenantdb", () => ({ tdb: (t: string) => ({ from: (table: string) => { const b = builder(table) as Record<string, unknown>; (qs[qs.length - 1].filters).push(["tenant", t]); return b; } }) }));
vi.mock("../handlehub", async (orig) => ({ ...(await orig<typeof import("../handlehub")>()), listEntryPoints: vi.fn(async () => entryPoints) }));

import { handoffCodeIn, newLinkCode, newTypedCode, createHandoff, claimHandoff, handoffLink, youtubeInvite, withInviteButton, ruleInviteLink, INVITE_LABEL, listHandoffs } from "../handoff";
import { parseRef } from "../handlehub";
import { handoffFields } from "../igcomments";

beforeEach(() => { qs.length = 0; insertErrors = []; claimRow = null; orderRows = []; handoffRows = []; entryPoints = [{ number: "919876543210", greeting: "Hi!" }]; });

describe("codes", () => {
  it("link codes are 10 characters; YouTube codes are typed YT-dddd", () => {
    expect(newLinkCode()).toMatch(/^[a-z0-9]{10}$/);
    expect(newTypedCode()).toMatch(/^YT-\d{4}$/);
  });
  it("a hidden 10-character code is a handoff; Handle Hub's 7- and 12-character codes are not", () => {
    expect(handoffCodeIn("Hi!", "abcde12345")).toBe("abcde12345");
    expect(handoffCodeIn("Hi!", "abc1234")).toBeNull();
    expect(handoffCodeIn("Hi!", "abcdef123456")).toBeNull();
  });
  it("a typed YouTube code is read however they type it", () => {
    for (const t of ["YT-4821", "yt 4821", "my code is yt4821 thanks"]) expect(handoffCodeIn(t, null)).toBe("YT-4821");
    expect(handoffCodeIn("I paid 4821 rupees", null)).toBeNull();
  });
  it("the code survives the round trip through a real wa.me link", () => {
    const url = new URL(handoffLink("919876543210", "abcde12345", "Hi! I'd like the guide"));
    expect(url.host).toBe("wa.me");
    expect(url.pathname).toBe("/919876543210");
    const text = url.searchParams.get("text")!;
    expect(text.startsWith("Hi! I'd like the guide")).toBe(true);
    expect(handoffCodeIn(text, parseRef(text))).toBe("abcde12345");
  });
  it("a YouTube invitation has no link and no phone number", () => {
    const s = youtubeInvite("YT-4821");
    expect(s).toContain("YT-4821");
    expect(s).not.toMatch(/https?:|wa\.me|www\.|\d{8,}/);
  });
});

describe("making and claiming", () => {
  it("draws another code when one is taken, and gives up quietly on any other error", async () => {
    insertErrors = [{ code: "23505", message: "duplicate" }, null];
    expect((await createHandoff({ tenantId: "t1", platform: "instagram", channelId: "c1" }))?.id).toBe("h1");
    insertErrors = [{ code: "42P01", message: "relation wa_handoffs does not exist" }];
    await expect(createHandoff({ tenantId: "t1", platform: "instagram", channelId: "c1" })).resolves.toBeNull();
  });
  it("claims only in this workspace, only an open and unexpired code", async () => {
    claimRow = null;
    expect(await claimHandoff("t1", "abcde12345", "919999")).toBeNull();
    const q = qs.find(x => x.op === "update")!;
    expect(q.payload).toMatchObject({ claimed_phone: "919999" });
    expect(q.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", "t1"], ["eq", "code", "abcde12345"], ["is", "claimed_at", null], ["gt", "expires_at", expect.any(String)]]));
  });
});

describe("the rule's invitation", () => {
  const rule = { id: "r1", waHandoff: true, waHandoffMessage: "Here's your guide: https://x.y" };
  it("off, no WhatsApp number, or no message → no button, and the DM still goes", async () => {
    expect(await ruleInviteLink({ ...rule, waHandoff: false }, "instagram", { tenantId: "t1", channelId: "c1" })).toBeNull();
    expect(await ruleInviteLink({ ...rule, waHandoffMessage: " " }, "instagram", { tenantId: "t1", channelId: "c1" })).toBeNull();
    entryPoints = [];
    expect(await ruleInviteLink(rule, "instagram", { tenantId: "t1", channelId: "c1" })).toBeNull();
  });
  it("on, with a number → the workspace's own wa.me link, carrying the rule's message for arrival", async () => {
    const link = await ruleInviteLink(rule, "facebook", { tenantId: "t1", channelId: "c1", commentId: "cm1", text: "price?" });
    expect(link).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(qs.find(q => q.op === "insert")!.payload).toMatchObject({ platform: "facebook", source_ref: "cm1", source_text: "price?", rule_id: "r1", message: "Here's your guide: https://x.y" });
  });
  it("the button is last and the DM never exceeds Meta's three", () => {
    const three = [1, 2, 3].map(i => ({ type: "web_url", url: `https://${i}`, title: `B${i}` }));
    const out = withInviteButton(three, "https://wa.me/1");
    expect(out.length).toBe(3);
    expect(out[2]).toEqual({ type: "web_url", url: "https://wa.me/1", title: INVITE_LABEL });
    expect(INVITE_LABEL.length).toBeLessThanOrEqual(20);
    expect(withInviteButton(three, null)).toBe(three);
  });
  it("a rule with the option on must say what to send on WhatsApp", () => {
    expect(handoffFields({ waHandoff: true, waHandoffMessage: "" })).toHaveProperty("error");
    expect(handoffFields({})).toEqual({ row: {} });
    expect(handoffFields({ waHandoff: true, waHandoffMessage: " hi " })).toEqual({ row: { wa_handoff: true, wa_handoff_message: "hi" } });
  });
});

describe("on arrival (the WhatsApp webhook)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/webhooks/whatsapp/route.ts"), "utf8");
  it("claims within the receiving number's own workspace", () => {
    expect(src).toMatch(/const handoff = handoffCode \? await claimHandoff\(tid, handoffCode, from\)/);
  });
  it("sends what the rule promised as that turn's reply, before welcome or AI", () => {
    const at = src.indexOf("if (handoff?.message) {");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf("const inSequence = await hasActiveEnrollment"));
    expect(src.slice(at, at + 500)).toMatch(/claimWelcome\(conv\.id\)[\s\S]*sendText\(from, handoff\.message, channel\)[\s\S]*return;/);
  });
});

describe("what it produced", () => {
  it("counts only paid orders placed after the chat started", async () => {
    handoffRows = [{ id: "h1", tenant_id: "t1", code: "abcde12345", platform: "instagram", created_at: "2026-10-20T00:00:00Z", expires_at: "2026-11-19T00:00:00Z", claimed_at: "2026-10-21T10:00:00Z", claimed_phone: "9199" }];
    orderRows = [
      { phone: "9199", total_cents: 49_900, status: "paid", created_at: "2026-10-22T00:00:00Z" },
      { phone: "9199", total_cents: 10_000, status: "paid", created_at: "2026-10-01T00:00:00Z" },   // before the chat: not this handoff's
    ];
    const r = await listHandoffs("t1", { platform: "instagram", days: 30 });
    expect(r.rows[0]).toMatchObject({ orders: 1, revenueCents: 49_900 });
    expect(r.summary).toMatchObject({ orders: 1, revenueCents: 49_900 });
    const orders = qs.filter(q => q.table === "wa_orders");
    expect(orders[0].filters).toEqual(expect.arrayContaining([["eq", "tenant_id", "t1"], ["in", "status", ["paid", "fulfilled"]]]));
  });
});
