import { beforeEach, describe, expect, it, vi } from "vitest";
import { memdb } from "./helpers/memdb";
const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/memdb").MemDb, settings: {} as Record<string, Record<string, unknown>> }));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../team", () => ({ hashPassword: vi.fn() }));
vi.mock("../store", () => ({
  getTenantSetting: async (tenant: string, key: string, fallback: unknown) => h.settings[tenant]?.[key] ?? fallback,
  setTenantSetting: async (tenant: string, key: string, value: unknown) => { (h.settings[tenant] ??= {})[key] = value; },
}));
import { getVocabState, saveVocab } from "../vocabstore";
import { INDUSTRY_PACKS } from "../vocab";
import { reviewSamples } from "../industry-samples";
import { followPublicPrompt } from "../ig-follow-policy";

beforeEach(() => {
  h.db = memdb(); h.settings = {};
  h.db.tables.tenants = [{ id: "school", industry: "Education / EdTech" }, { id: "tech", industry: "SaaS / Tech" }];
});

describe("signup industry → terminology → review examples", () => {
  it("resolves each tenant's saved signup domain independently", async () => {
    const school = await getVocabState("school");
    const tech = await getVocabState("tech");
    expect(school.vocab.contact.one).toBe("Student");
    expect(reviewSamples(school.industry)[0].text).toContain("course");
    expect(tech.vocab.product.one).toBe("Plan");
    expect(reviewSamples(tech.industry)[1].text).toContain("subscription");
    expect(reviewSamples(tech.industry)[1].text).not.toMatch(/food|biryani|cafe|table/i);
  });
  it("honours a later domain selection and custom terms, including explicit Other", async () => {
    const changed = await saveVocab("school", { industry: "healthcare", overrides: { contact: { one: "Visitor", many: "Visitors" } } });
    expect(changed.industry).toBe("healthcare"); expect(changed.vocab.contact.one).toBe("Visitor");
    expect(reviewSamples(changed.industry)[0].text).toContain("appointment");
    const other = await saveVocab("school", { industry: "generic" });
    expect(other.industry).toBe("generic"); expect(other.vocab.contact.one).toBe("Visitor");
  });
  it("uses neutral examples for unknown or missing domains", async () => {
    expect((await getVocabState("unknown")).industry).toBe("generic");
    expect(reviewSamples(null)).toEqual(reviewSamples("unrecognised"));
    expect(reviewSamples(null).map(s => s.text).join(" ")).not.toMatch(/food|biryani|cafe|table/i);
  });
  it("has a distinct sample set for every selectable business domain", () => {
    const sets = INDUSTRY_PACKS.map(p => reviewSamples(p.label));
    expect(new Set(sets.map(s => JSON.stringify(s))).size).toBe(INDUSTRY_PACKS.length);
    for (const set of sets) expect(set.map(s => s.rating)).toEqual([5, 5, 4, 2]);
  });
  it("always includes an actionable DM keyword within the public reply length limit", () => {
    const text = followPublicPrompt("x".repeat(500), "Intro ".repeat(500));
    expect(text.length).toBeLessThanOrEqual(280);
    expect(text).toContain("then DM us");
    expect(followPublicPrompt(null)).toContain('“LINK”');
  });
});
