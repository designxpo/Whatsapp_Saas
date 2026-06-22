import { describe, it, expect } from "vitest";
import { isPersonalizedAnswer } from "../router/cache";

// Guards the cross-customer name-bleed fix: a name-personalised answer must be
// detected so it's never cached (and is purged on read), while generic answers
// stay cacheable. Tenant scoping does NOT stop a name bleeding between two
// customers of the SAME tenant — this content guard does.
describe("isPersonalizedAnswer", () => {
  it("flags a leading greeting + name", () => {
    expect(isPersonalizedAnswer("Hi Govind! Here are the details.")).toBe(true);
    expect(isPersonalizedAnswer("Hello Basit Kamal, welcome back.")).toBe(true);
  });

  it("flags a TRAILING direct-address name (the reported bug)", () => {
    expect(isPersonalizedAnswer("The fee is ₹53,100. Do you have any other questions, Govind Kumar?")).toBe(true);
    expect(isPersonalizedAnswer("Thanks for asking, Govind!")).toBe(true);
    expect(isPersonalizedAnswer("Hope this helps, Tanvvi!")).toBe(true);
  });

  it("flags the requesting/answering contact's own name anywhere (knownName)", () => {
    expect(isPersonalizedAnswer("Sure Govind, here are the details.", "Govind")).toBe(true);
    expect(isPersonalizedAnswer("As discussed earlier with you.", "Govind")).toBe(false);
  });

  it("keeps generic, reusable answers cacheable", () => {
    expect(isPersonalizedAnswer("The fee is ₹53,100. Do you have any other questions?")).toBe(false);
    expect(isPersonalizedAnswer("We have centers in Noida and Bengaluru, plus online.")).toBe(false);
    expect(isPersonalizedAnswer("Hello! How can I help you today?")).toBe(false);
    expect(isPersonalizedAnswer("Thanks! Let me know if you need anything else.")).toBe(false);
    expect(isPersonalizedAnswer("Hope that helps! See you soon!")).toBe(false);
  });

  it("does not false-positive a generic sign-off ending on a capitalised closer", () => {
    expect(isPersonalizedAnswer("Glad I could help. Cheers!")).toBe(false);
    expect(isPersonalizedAnswer("Your batch starts next week. Thanks!")).toBe(false);
  });

  it("ignores a too-short knownName and respects word boundaries", () => {
    expect(isPersonalizedAnswer("I asked the team for you.", "Sk")).toBe(false);
    expect(isPersonalizedAnswer("Let me check.", "A")).toBe(false);
  });
});
