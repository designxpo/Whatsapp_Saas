import { describe, it, expect } from "vitest";
import { shouldWelcome, toWaNumber, type LeadWelcome } from "../leadwelcome";

describe("toWaNumber", () => {
  it("prepends 91 to a bare 10-digit Indian number so WhatsApp can deliver", () => {
    expect(toWaNumber("9999730196")).toBe("919999730196");
  });
  it("leaves an already-country-coded number untouched", () => {
    expect(toWaNumber("919999730196")).toBe("919999730196");
  });
  it("strips a trunk 0 then adds the country code", () => {
    expect(toWaNumber("09999730196")).toBe("919999730196");
  });
  it("passes a foreign number (its own code) through", () => {
    expect(toWaNumber("4917612345678")).toBe("4917612345678");
  });
  it("normalizes formatting (+, spaces, dashes)", () => {
    expect(toWaNumber("+91 99997-30196")).toBe("919999730196");
    expect(toWaNumber("")).toBe("");
  });
});

const CFG: LeadWelcome = { enabled: true, templateName: "signup_welcome", languageCode: "en", nameParam: true, flowId: "flow1", trigger: "created", sourceContains: "" };
const fresh = { alreadyWelcomed: false, optedOut: false };

describe("shouldWelcome", () => {
  it("fires on lead_created when fully configured + fresh", () => {
    expect(shouldWelcome(CFG, { event: "lead_created", stage: null, source: "landing-page" }, undefined, fresh)).toBe(true);
  });

  it("stays dormant unless enabled AND a template AND a flow are set", () => {
    expect(shouldWelcome({ ...CFG, enabled: false }, { event: "lead_created", stage: null, source: null }, undefined, fresh)).toBe(false);
    expect(shouldWelcome({ ...CFG, templateName: "" }, { event: "lead_created", stage: null, source: null }, undefined, fresh)).toBe(false);
    expect(shouldWelcome({ ...CFG, flowId: "" }, { event: "lead_created", stage: null, source: null }, undefined, fresh)).toBe(false);
  });

  it("never re-blasts an already-welcomed or opted-out lead", () => {
    expect(shouldWelcome(CFG, { event: "lead_created", stage: null, source: null }, undefined, { alreadyWelcomed: true, optedOut: false })).toBe(false);
    expect(shouldWelcome(CFG, { event: "lead_created", stage: null, source: null }, undefined, { alreadyWelcomed: false, optedOut: true })).toBe(false);
  });

  it("respects the optional Source scope (case-insensitive contains)", () => {
    const scoped = { ...CFG, sourceContains: "PPC" };
    expect(shouldWelcome(scoped, { event: "lead_created", stage: null, source: "ppc-landing" }, undefined, fresh)).toBe(true);
    expect(shouldWelcome(scoped, { event: "lead_created", stage: null, source: "organic" }, undefined, fresh)).toBe(false);
    expect(shouldWelcome(scoped, { event: "lead_created", stage: null, source: null }, undefined, fresh)).toBe(false);
  });

  it("created-trigger ignores stage_changed events", () => {
    expect(shouldWelcome(CFG, { event: "stage_changed", stage: "RNR", source: null }, "New", fresh)).toBe(false);
  });

  it("stage-trigger fires only on ENTERING the configured stage (a transition)", () => {
    const staged = { ...CFG, trigger: "Signup Form" };
    // entering the stage → fire
    expect(shouldWelcome(staged, { event: "stage_changed", stage: "Signup Form", source: null }, "New", fresh)).toBe(true);
    // same stage replayed (no transition) → no-op
    expect(shouldWelcome(staged, { event: "stage_changed", stage: "Signup Form", source: null }, "signup form", fresh)).toBe(false);
    // a different stage → no fire
    expect(shouldWelcome(staged, { event: "stage_changed", stage: "RNR", source: null }, "New", fresh)).toBe(false);
  });
});
