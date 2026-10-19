// Areas are inferred from content, not declared. These pin the parts that must not
// drift: names are directory-safe, the model's reply is parsed defensively, areas
// are reused rather than multiplied, the cap holds, and with no AI key filing falls
// back to keyword hints instead of failing.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  hasKey: true,
  replies: [] as string[],
  prompts: [] as string[],
  throwOnChat: false,
}));

vi.mock("../ai/keys", () => ({
  resolveTenantAi: async () => {
    if (!h.hasKey) throw new Error("no key");
    return { provider: "gemini", apiKey: "k", model: "m" };
  },
}));
vi.mock("../ai/chat", () => ({
  runChat: async (o: { turns: { text: string }[] }) => {
    h.prompts.push(o.turns[0].text);
    if (h.throwOnChat) throw new Error("model down");
    return { text: h.replies.shift() ?? "[]", toolCalls: [] };
  },
}));
vi.mock("../errors", () => ({ errorMessage: (e: unknown) => String(e) }));

import { areaSlug, areaTitle, parseAssignments, assignAreas, MAX_AREAS, CATCH_ALL } from "../kbareas";

beforeEach(() => { h.hasKey = true; h.replies = []; h.prompts = []; h.throwOnChat = false; });

describe("area names", () => {
  it("become directory-safe slugs", () => {
    expect(areaSlug("Room Types")).toBe("room-types");
    expect(areaSlug("Pricing & Payment")).toBe("pricing-and-payment");
    expect(areaSlug("  --Opening hours!  ")).toBe("opening-hours");
  });
  it("refuse a name with nothing usable in it", () => {
    expect(areaSlug("")).toBeNull();
    expect(areaSlug("!!!")).toBeNull();
    expect(areaSlug("a")).toBeNull();
  });
  it("cap the length so a path stays sane", () => {
    expect(areaSlug("x".repeat(80))!.length).toBeLessThanOrEqual(32);
  });
  it("read back as a title a person would write", () => {
    expect(areaTitle("room-types")).toBe("Room types");
    expect(areaTitle("")).toBe("Unfiled");
  });
});

describe("reading the model's reply", () => {
  it("accepts a clean array", () => {
    expect(parseAssignments('[{"i":0,"area":"pricing"},{"i":1,"area":"hours"}]')).toHaveLength(2);
  });
  it("tolerates code fences and chatter around it", () => {
    expect(parseAssignments('Sure!\n```json\n[{"i":0,"area":"pricing"}]\n```')).toHaveLength(1);
  });
  it("returns nothing for garbage rather than throwing", () => {
    expect(parseAssignments("I cannot do that")).toEqual([]);
    expect(parseAssignments("[not json]")).toEqual([]);
  });
  it("drops entries without a numeric index", () => {
    expect(parseAssignments('[{"area":"pricing"},{"i":"x","area":"y"}]')).toEqual([]);
  });
});

describe("assigning areas from content", () => {
  const item = (title: string, text = "Details about it.") => ({ title, text });

  it("files each concept under the area the model names", async () => {
    h.replies = ['[{"i":0,"area":"Room types"},{"i":1,"area":"Opening hours"}]'];
    const r = await assignAreas([item("Deluxe room"), item("Reception hours")], []);
    expect(r.map(x => x.area)).toEqual(["room-types", "opening-hours"]);
    expect(r.every(x => x.source === "model")).toBe(true);
  });

  it("shows the model the workspace's EXISTING areas so it can reuse them", async () => {
    h.replies = ['[{"i":0,"area":"pricing"}]'];
    await assignAreas([item("Rates")], ["pricing", "room-types"]);
    expect(h.prompts[0]).toContain("- pricing");
    expect(h.prompts[0]).toContain("- room-types");
  });

  it("carries areas created in one batch into the next, so they are reused not duplicated", async () => {
    const many = Array.from({ length: 25 }, (_, i) => item(`Item ${i}`));
    h.replies = [
      JSON.stringify(many.slice(0, 20).map((_, i) => ({ i, area: "menu" }))),
      JSON.stringify(many.slice(20).map((_, i) => ({ i, area: "menu" }))),
    ];
    await assignAreas(many, []);
    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]).toContain("- menu");
  });

  it("stops creating areas at the cap — further subjects share a catch-all", async () => {
    const existing = Array.from({ length: MAX_AREAS }, (_, i) => `area-${i}`);
    h.replies = ['[{"i":0,"area":"brand-new-subject"},{"i":1,"area":"area-3"}]'];
    const r = await assignAreas([item("A"), item("B")], existing);
    expect(r[0].area).toBe(CATCH_ALL);       // would have been area 15
    expect(r[1].area).toBe("area-3");        // reusing an existing one is always fine
  });

  it("falls back to keyword hints when the workspace has no AI key", async () => {
    h.hasKey = false;
    const r = await assignAreas([item("Refund policy", "Fees, EMI, instalments, payment plan, discount and refund of the price.")], []);
    expect(r[0].source).toBe("keywords");
    expect(r[0].area).toBe("pricing");
    expect(h.prompts).toHaveLength(0);
  });

  it("falls back per concept when the model call fails — never throws", async () => {
    h.throwOnChat = true;
    const r = await assignAreas([item("Refund policy", "Fees, EMI, instalments, payment plan, discount and refund of the price.")], []);
    expect(r[0].area).toBe("pricing");
  });

  it("leaves a concept unfiled when nothing places it, for a person to decide", async () => {
    h.hasKey = false;
    const r = await assignAreas([item("Misc", "The quick brown fox jumped over the lazy dog.")], []);
    expect(r[0]).toEqual({ area: null, confidence: 0, source: "none" });
  });

  it("falls back for items the model skipped in its reply", async () => {
    h.replies = ['[{"i":0,"area":"menu"}]'];
    const r = await assignAreas([item("Starters"), item("Rates", "Fees, EMI, instalments, payment plan, discount and refund of the price.")], []);
    expect(r[0].area).toBe("menu");
    expect(r[1].area).toBe("pricing");
  });

  it("returns an empty list for no input without calling the model", async () => {
    expect(await assignAreas([], [])).toEqual([]);
    expect(h.prompts).toHaveLength(0);
  });
});
