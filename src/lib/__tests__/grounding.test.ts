import { describe, it, expect } from "vitest";
import { enforceGrounding } from "../guard/grounding";
import { sanitizeOutbound } from "../guard/sanitize";

const APPROVED = "info@analytixlabs.co.in";

// The GroundingFirewall: a high-risk specific may only survive if it traces to the
// retrieved context (its allow-set) or the approved contact config. These lock in
// the four production incidents + the normalizer equivalences that keep correctly
// grounded facts from being falsely deferred.
describe("GroundingFirewall — contact classes (default on)", () => {
  it("rewrites a hallucinated company-domain email to the approved inbox (the training@ leak)", () => {
    const r = enforceGrounding("For trainer details, contact training@analytixlabs.co.in.", "", { approvedEmail: APPROVED });
    expect(r.text).toBe("For trainer details, contact info@analytixlabs.co.in.");
    expect(r.actions[0]).toMatchObject({ cls: "EMAIL", disposition: "rewrite" });
  });

  it("keeps a company email that DOES appear in the retrieved context", () => {
    const ctx = "[1] For careers write to careers@analytixlabs.co.in.";
    const r = enforceGrounding("You can reach the team at careers@analytixlabs.co.in.", ctx, { approvedEmail: APPROVED });
    expect(r.text).toContain("careers@analytixlabs.co.in");
  });

  it("leaves a foreign-domain email alone (may be the customer's own, echoed)", () => {
    const r = enforceGrounding("I've noted your email priya@gmail.com.", "", { approvedEmail: APPROVED });
    expect(r.text).toContain("priya@gmail.com");
  });

  it("strips an ungrounded URL but keeps one whose domain is in context", () => {
    const ctx = "[1] Brochure: https://www.analytixlabs.co.in/brochure.pdf";
    const stripped = enforceGrounding("See https://random-fake-site.com/deal for details.", ctx, { approvedEmail: APPROVED });
    expect(stripped.text).not.toContain("random-fake-site.com");
    const kept = enforceGrounding("Brochure here: https://www.analytixlabs.co.in/brochure.pdf", ctx, { approvedEmail: APPROVED });
    expect(kept.text).toContain("analytixlabs.co.in/brochure.pdf");
  });

  it("defers an invented phone, keeps an approved one", () => {
    const invented = enforceGrounding("Call us at +91 90000 11111 anytime.", "", { approvedPhones: ["+91 9555219007"] });
    expect(invented.text).not.toContain("90000");
    expect(invented.actions.some(a => a.cls === "PHONE")).toBe(true);
    const approved = enforceGrounding("Call us at +91 9555219007 anytime.", "", { approvedPhones: ["+91 9555219007"] });
    expect(approved.text).toContain("9555219007");
  });
});

describe("GroundingFirewall — fabricated specifics (the duration/fee incidents)", () => {
  it("defers a fabricated duration when the context has none (the 3.5–4 months incident)", () => {
    const reply = "The Data Science & GenAI program is a Weekend Program of 3.5-4 Months duration. Is there anything else I can help you with?";
    const r = enforceGrounding(reply, "", {});
    expect(r.text).not.toContain("3.5");
    expect(r.text).not.toMatch(/months/i);
    expect(r.text).toContain("Is there anything else");           // the non-specific sentence survives
    expect(r.actions.some(a => a.cls === "DURATION")).toBe(true);
  });

  it("keeps a duration that matches the context across surface forms", () => {
    const ctx = "[1] The Data Science program runs for a six-month duration.";
    expect(enforceGrounding("It's a 6 months program.", ctx, {}).text).toContain("6 months");
    expect(enforceGrounding("It's a 6-month program.", ctx, {}).text).toContain("6-month");
  });

  it("defers a fabricated fee but keeps a grounded one (currency normalization)", () => {
    const ctx = "[1] The course fee is Rs 50000 inclusive of taxes.";
    expect(enforceGrounding("The fee is ₹50,000.", ctx, {}).text).toContain("₹50,000");
    const bad = enforceGrounding("The fee is ₹99,999.", ctx, {});
    expect(bad.text).not.toContain("99,999");
    expect(bad.actions.some(a => a.cls === "CURRENCY")).toBe(true);
  });

  it("does not touch a benign list ordinal (DATE/NUMBER classes off by default)", () => {
    const r = enforceGrounding("Here are the top 3 reasons to enrol.", "", {});
    expect(r.text).toBe("Here are the top 3 reasons to enrol.");
  });

  it("per-class override can disable a class", () => {
    const r = enforceGrounding("The fee is ₹99,999.", "", { enabled: { CURRENCY: false } });
    expect(r.text).toContain("₹99,999");
  });
});

describe("sanitizeOutbound — composed persona + grounding chokepoint", () => {
  it("strips a persona label AND rewrites an invented email in one pass", () => {
    const r = sanitizeOutbound("MAYA SUPPORT: Please email training@analytixlabs.co.in.", { agentName: "Maya", context: "", approvedEmail: APPROVED });
    expect(r.text).not.toMatch(/MAYA SUPPORT/i);
    expect(r.text).toContain("info@analytixlabs.co.in");
    expect(r.text).not.toContain("training@");
  });

  it("leaves a clean grounded reply untouched", () => {
    const ctx = "[1] The Data Science course is a six-month program.";
    const reply = "Great question! The Data Science course runs for 6 months. Happy to help further!";
    expect(sanitizeOutbound(reply, { agentName: "Maya", context: ctx }).text).toBe(reply);
  });

  it("never mangles a greeting (no high-risk tokens)", () => {
    expect(sanitizeOutbound("Hi there! 👋 How can I help you today?", { context: "" }).text).toBe("Hi there! 👋 How can I help you today?");
  });
});
