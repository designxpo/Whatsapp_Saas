import { describe, it, expect } from "vitest";
import { GENERIC_VOCAB, INDUSTRY_PACKS, VOCAB_KEYS, industryPack, resolveVocab, sanitizeOverrides } from "../vocab";

describe("vocab", () => {
  it("resolves signup labels and ids to a pack; unknown → generic", () => {
    expect(industryPack("Education / EdTech").id).toBe("education");
    expect(industryPack("healthcare").id).toBe("healthcare");
    expect(industryPack("Other").id).toBe("generic");
    expect(industryPack("nonsense").id).toBe("generic");
    expect(industryPack(null).id).toBe("generic");
  });

  it("every pack resolves every key with singular and plural", () => {
    for (const p of INDUSTRY_PACKS) {
      const v = resolveVocab(p.id);
      for (const k of VOCAB_KEYS) { expect(v[k].one.length).toBeGreaterThan(1); expect(v[k].many.length).toBeGreaterThan(1); }
    }
    expect(resolveVocab("generic")).toEqual(GENERIC_VOCAB);
  });

  it("uses irregular plurals from the pack", () => {
    expect(resolveVocab("realestate").product.many).toBe("Properties");
    expect(resolveVocab("education").lead.many).toBe("Enquiries");
  });

  it("overrides win over the pack; a lone singular gets a naive plural", () => {
    const v = resolveVocab("education", { contact: { one: "Learner" }, product: { one: "Batch", many: "Batches" } });
    expect(v.contact).toEqual({ one: "Learner", many: "Learners" });
    expect(v.product).toEqual({ one: "Batch", many: "Batches" });
    expect(v.teamMember.one).toBe("Counsellor");
  });

  it("sanitizes stored overrides", () => {
    const o = sanitizeOverrides({ contact: { one: "  Pa<tient  ", many: "x" }, bogus: { one: "Nope" }, lead: "str", product: { one: "A".repeat(40) } });
    expect(o).toEqual({ contact: { one: "Patient" } });
    expect(sanitizeOverrides(null)).toEqual({});
  });
});

import { vocabPromptNote } from "../vocab";
describe("vocab — pipeline + AI note", () => {
  it("every industry board ends with a won and a lost column, 3+ stages", () => {
    for (const p of INDUSTRY_PACKS) if (p.stages) expect(p.stages.length).toBeGreaterThanOrEqual(5);
  });
  it("AI note is empty for the neutral pack and names the swaps otherwise", () => {
    expect(vocabPromptNote(resolveVocab("generic"))).toBeNull();
    const note = vocabPromptNote(resolveVocab("education"))!;
    expect(note).toContain('"student"');
    expect(note).toContain('"course"');
  });
});
