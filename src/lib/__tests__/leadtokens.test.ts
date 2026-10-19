// What a sequence step's {token} params resolve to, for one lead.
//
// Generic by design: tokens are the lead's own name and attributes. Nothing here
// knows what a workspace sells, so none of these tests may either.
import { describe, it, expect } from "vitest";
import { firstName, leadTokens, missingTokens, normLabel } from "../leadtokens";

describe("firstName", () => {
  it("greets by first name, capitalised", () => {
    expect(firstName("rahul sharma")).toBe("Rahul");
    expect(firstName("RAHUL SHARMA")).toBe("Rahul");
  });
  it("returns nothing for a phone number or nothing at all — a number is not a name", () => {
    expect(firstName("9876543210")).toBe("");
    expect(firstName("")).toBe("");
    expect(firstName(null)).toBe("");
  });
  it("keeps accented and hyphenated names intact", () => {
    expect(firstName("José Álvarez")).toBe("José");
    expect(firstName("Anne-Marie Dupont")).toBe("Anne-marie");
  });
});

describe("leadTokens", () => {
  it("exposes every contact attribute, lower-cased, so CRM exports that disagree about case still resolve", () => {
    const t = leadTokens({ name: "Asha", attributes: { City: "Pune", PLAN: "Starter" } });
    expect(t.city).toBe("Pune");
    expect(t.plan).toBe("Starter");
  });
  it("derives name and first_name, and they cannot be shadowed by an attribute of the same name", () => {
    const t = leadTokens({ name: "asha rao", attributes: { first_name: "stale" } });
    expect(t.name).toBe("asha rao");
    expect(t.first_name).toBe("Asha");
  });
  it("lets the caller add or override values", () => {
    expect(leadTokens({ name: "A" }, { slot: "7 PM" }).slot).toBe("7 PM");
  });
  it("copes with no contact at all", () => {
    expect(leadTokens(null).first_name).toBe("");
  });
});

describe("missingTokens", () => {
  it("names the tokens that resolve to nothing, so the step is skipped with a reason", () => {
    const tokens = leadTokens({ name: "Asha", attributes: { city: "Pune" } });
    expect(missingTokens(["{first_name}", "{city}", "{plan}"], tokens)).toEqual(["plan"]);
  });
  it("ignores literal params", () => {
    expect(missingTokens(["Diwali offer"], {})).toEqual([]);
  });
});

describe("normLabel", () => {
  it("makes case, punctuation and '&' irrelevant", () => {
    expect(normLabel("Data Analytics & AI")).toBe(normLabel("data analytics and ai"));
  });
});
