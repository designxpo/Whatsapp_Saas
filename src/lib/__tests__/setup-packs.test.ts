// Phase 4: industry setup packs (preview, apply only what's missing, never
// overwrite), knowledge checks (pass/fail rules, saved results) and documents
// due for review. Real lib code over the in-memory database.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({
  m: null as unknown as MemDb,
  replies: {} as Record<string, { reply: string | null; escalate: boolean } | "throw">,
  agentFails: false,
}));

vi.mock("../supabase", () => ({ db: () => h.m.client }));
vi.mock("../tenantdb", () => ({
  tdb: (t: string) => ({
    from: (tb: string) => {
      const b = h.m.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert, ups = b.upsert;
      const stamp = (p: unknown) => (Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      b.insert = (p: unknown) => ins(stamp(p));
      b.upsert = (p: unknown, o?: unknown) => ups(stamp(p), o);
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  }),
}));
vi.mock("../kb", () => ({ embedTexts: async () => [[0.1, 0.2]] }));
vi.mock("../moderation", () => ({ assertTextsAllowed: async () => undefined, assertTextAllowed: async () => undefined }));
vi.mock("../aihub", async orig => {
  const real = await orig<typeof import("../aihub")>();
  return { ...real, saveAgent: async (...a: Parameters<typeof real.saveAgent>) => { if (h.agentFails) throw new Error("embedding quota"); return real.saveAgent(...a); } };
});
vi.mock("../llm", () => ({
  FALLBACK_REPLY: "Let me connect you with the team.",
  generateReply: async (hist: { body: string }[]) => {
    const r = h.replies[hist[0].body];
    if (r === "throw") throw new Error("AI_BUSY");
    return { ...(r ?? { reply: null, escalate: true }), usedChunks: 1 };
  },
}));

import { PACKS, packById, previewPack, applyPack, suggestedPack } from "../industry-packs";
import { judgeAnswer, addKbTest, runKbTests, listKbTests } from "../kb-tests";
import { documentsToReview, setReviewBy } from "../kb-review";
import { setReviewSettings } from "../reviews";
import { saveWorkSettings, getWorkSettings } from "../work-settings";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-11-06T06:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  h.m = memdb({ wa_quick_replies: [["tenant_id", "shortcut"]], wa_kb_tests: [["tenant_id", "question"]], wa_settings: [["tenant_id", "key"]] });
  h.replies = {}; h.agentFails = false;
});
afterEach(() => vi.useRealTimers());

describe("pack content", () => {
  it.each(PACKS.map(p => [p.id, p] as const))("%s is safe to switch on", (_id, p) => {
    expect(p.agents.length).toBeGreaterThanOrEqual(2);                       // routing needs a choice
    for (const a of p.agents) {
      expect(a.routingKeywords.split(",").length).toBeGreaterThan(5);
      expect(a.constraintsText).toMatch(/never guess/);                       // no invented prices or timings
    }
    // Every journey message lands inside WhatsApp's 24-hour window as plain text.
    const total = p.journey.steps.reduce((s, x) => s + x.delayMinutes, 0);
    expect(total).toBeLessThan(23.5 * 60);
    expect(new Set(p.quickReplies.map(q => q.shortcut)).size).toBe(p.quickReplies.length);
    expect(p.tests.length).toBeGreaterThanOrEqual(3);
    expect(p.notIncluded.length).toBeGreaterThan(20);
  });

  it("keeps medical questions with the clinic and never promises results", () => {
    const clinic = packById("clinic")!;
    expect(clinic.agents.every(a => /hand over/.test(a.constraintsText))).toBe(true);
    expect(clinic.agents[0].constraintsText).toMatch(/Never give medical advice/);
    expect(clinic.tests.filter(t => t.expectHandoff).length).toBeGreaterThanOrEqual(2);
    expect(packById("coaching")!.agents[0].constraintsText).toMatch(/Never promise results/);
  });

  it("suggests the pack for the industry chosen at signup", () => {
    expect(suggestedPack("restaurant")?.id).toBe("restaurant");
    expect(suggestedPack("healthcare")?.id).toBe("clinic");
    expect(suggestedPack("education")?.id).toBe("coaching");
    expect(suggestedPack("saas")).toBeNull();
  });
});

describe("applying a pack", () => {
  const restaurant = packById("restaurant")!;

  it("previews everything as new for a fresh workspace, and applies exactly that", async () => {
    const plan = await previewPack(T, restaurant);
    expect(plan.every(i => i.status === "create" || i.status === "set")).toBe(true);
    const r = await applyPack(T, restaurant, "asha@biz.test");
    expect(r.failed).toEqual([]);
    expect(r.done.length).toBe(plan.length);
    const t = h.m.tables;
    expect(t.wa_ai_agents.filter(a => a.tenant_id === T).map(a => [a.name, a.active])).toEqual([["Reservations host", false], ["Menu & orders", false]]);
    const seq = t.wa_sequences.find(s => s.tenant_id === T)!;
    expect(seq).toMatchObject({ name: "Table enquiry follow-up", active: false, trigger_kind: "manual" });
    expect(t.wa_sequence_steps.filter(s => s.sequence_id === seq.id)).toHaveLength(2);
    expect(t.wa_quick_replies.filter(q => q.tenant_id === T).map(q => q.shortcut).sort()).toEqual(["full-tonight", "menu", "order-ready", "table-confirmed"]);
    expect((await getWorkSettings(T)).replyTargetMinutes).toBe(10);
    expect((await listKbTests(T)).tests.map(x => x.question)).toHaveLength(4);
  });

  it("is safe to apply twice: nothing new, nothing changed", async () => {
    await applyPack(T, restaurant, "a");
    const before = JSON.stringify(h.m.tables);
    const plan = await previewPack(T, restaurant);
    expect(plan.every(i => i.status === "skip" || i.status === "keep")).toBe(true);
    const r = await applyPack(T, restaurant, "a");
    expect(r.done.filter(i => i.kind !== "review_style" && i.kind !== "reply_target")).toEqual([]);
    expect(JSON.stringify({ ...h.m.tables, wa_settings: [] })).toBe(JSON.stringify({ ...JSON.parse(before), wa_settings: [] }));
  });

  it("never overwrites what the business already has", async () => {
    h.m.tables.wa_ai_agents = [{ id: "mine", tenant_id: T, name: "reservations HOST", persona: "Our own words", active: true }];
    h.m.tables.wa_quick_replies = [{ tenant_id: T, shortcut: "menu", body: "Our own menu text" }];
    await setReviewSettings(T, { businessType: "hotel" });
    await saveWorkSettings(T, { replyTargetMinutes: 45 });
    const plan = await previewPack(T, restaurant);
    expect(plan.find(i => i.name === "Reservations host")!.status).toBe("skip");
    expect(plan.find(i => i.name === "/menu")!.status).toBe("skip");
    expect(plan.find(i => i.kind === "review_style")!.status).toBe("keep");
    expect(plan.find(i => i.kind === "reply_target")!.status).toBe("keep");
    await applyPack(T, restaurant, "a");
    expect(h.m.tables.wa_ai_agents.find(a => a.id === "mine")).toMatchObject({ persona: "Our own words", active: true });
    expect(h.m.tables.wa_quick_replies.find(q => q.shortcut === "menu")!.body).toBe("Our own menu text");
    expect((await getWorkSettings(T)).replyTargetMinutes).toBe(45);
  });

  it("keeps going when one item fails, and says which", async () => {
    h.agentFails = true;
    const r = await applyPack(T, restaurant, "a");
    expect(r.failed.map(f => f.item.kind)).toEqual(["persona", "persona"]);
    expect(r.failed[0].error).toMatch(/quota/);
    expect(r.done.some(i => i.kind === "journey")).toBe(true);
  });

  it("only touches its own workspace", async () => {
    await applyPack(T, restaurant, "a");
    expect(await previewPack(O, restaurant).then(p => p.every(i => i.status === "create" || i.status === "set"))).toBe(true);
  });
});

describe("knowledge checks", () => {
  it("judges answers by the rules set for each question", () => {
    const ok = { reply: "We open at 10 am on Sundays.", handedOver: false };
    expect(judgeAnswer({ mustInclude: ["10 am", "sunday"], mustAvoid: [], expectHandoff: false }, ok).passed).toBe(true);
    expect(judgeAnswer({ mustInclude: ["9 am"], mustAvoid: [], expectHandoff: false }, ok)).toEqual({ passed: false, detail: "The answer didn't mention: 9 am." });
    expect(judgeAnswer({ mustInclude: [], mustAvoid: ["Sundays"], expectHandoff: false }, ok).passed).toBe(false);
    expect(judgeAnswer({ mustInclude: [], mustAvoid: [], expectHandoff: false }, { reply: null, handedOver: true }).detail).toMatch(/Add this to your knowledge base/);
    expect(judgeAnswer({ mustInclude: [], mustAvoid: [], expectHandoff: true }, { reply: null, handedOver: true }).passed).toBe(true);
    expect(judgeAnswer({ mustInclude: [], mustAvoid: [], expectHandoff: true }, ok).passed).toBe(false);
  });

  it("runs saved checks through the AI and keeps each result", async () => {
    await addKbTest(T, { question: "When do you open on Sunday?", mustInclude: ["10 am"] });
    await addKbTest(T, { question: "Is the curry nut-free?", expectHandoff: true });
    await addKbTest(T, { question: "Do you deliver?" });
    expect((await addKbTest(T, { question: "Do you deliver?" })).status).toBe(409);
    expect((await addKbTest(T, { question: "x" })).status).toBe(400);
    h.replies = {
      "When do you open on Sunday?": { reply: "We open at 10 am.", escalate: false },
      "Is the curry nut-free?": { reply: "It has no nuts!", escalate: false },     // should have handed over
      "Do you deliver?": "throw",
    };
    const results = await runKbTests(T);
    expect(results.map(r => [r.question, r.lastPassed])).toEqual([["When do you open on Sunday?", true], ["Is the curry nut-free?", false], ["Do you deliver?", null]]);
    expect(results[2].lastDetail).toMatch(/Couldn't run/);
    expect((await listKbTests(T)).tests.find(t => t.question === "Is the curry nut-free?")!.lastReply).toBe("It has no nuts!");
    expect((await listKbTests(O)).tests).toEqual([]);
  });
});

describe("documents to review", () => {
  it("lists documents past their review date or uploaded long ago, but not website pages", async () => {
    h.m.tables.kb_documents = [
      { id: "d1", tenant_id: T, title: "Price list", source_type: "pdf", status: "ready", created_at: "2026-10-01T00:00:00Z", review_by: "2026-11-01" },
      { id: "d2", tenant_id: T, title: "Old FAQ", source_type: "docx", status: "ready", created_at: "2026-01-01T00:00:00Z", review_by: null },
      { id: "d3", tenant_id: T, title: "Website", source_type: "url", status: "ready", created_at: "2026-01-01T00:00:00Z", review_by: null },
      { id: "d4", tenant_id: T, title: "Menu", source_type: "pdf", status: "ready", created_at: "2026-01-01T00:00:00Z", review_by: "2027-01-01" },
      { id: "dx", tenant_id: O, title: "Theirs", source_type: "pdf", status: "ready", created_at: "2026-01-01T00:00:00Z", review_by: null },
    ];
    expect((await documentsToReview(T, NOW)).docs.map(d => d.id)).toEqual(["d2", "d1"]);
    expect(await setReviewBy(T, "d1", "2027-02-01")).toEqual({ ok: true });
    expect((await setReviewBy(T, "d1", "soon")).status).toBe(400);
    expect((await setReviewBy(T, "dx", "2027-02-01")).status).toBe(404);
    expect((await documentsToReview(T, NOW)).docs.map(d => d.id)).toEqual(["d2"]);
  });
});
