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

  it("echoes back an email the CUSTOMER gave", () => {
    const r = enforceGrounding("I've noted your email priya@gmail.com.", "", { approvedEmail: APPROVED, customerText: "my email is Priya@gmail.com" });
    expect(r.text).toContain("priya@gmail.com");
  });

  it("removes an invented email on any other domain (it used to pass as 'maybe theirs')", () => {
    const r = enforceGrounding("Send the fee receipt to fees@pay-support.example.", "", { approvedEmail: APPROVED, customerText: "where do I send it?" });
    expect(r.text).not.toContain("pay-support");
    expect(r.actions).toContainEqual(expect.objectContaining({ cls: "EMAIL", disposition: "strip" }));
  });

  it("strips an ungrounded URL but keeps one whose domain is in context", () => {
    const ctx = "[1] Brochure: https://www.analytixlabs.co.in/brochure.pdf";
    const stripped = enforceGrounding("See https://random-fake-site.com/deal for details.", ctx, { approvedEmail: APPROVED });
    expect(stripped.text).not.toContain("random-fake-site.com");
    const kept = enforceGrounding("Brochure here: https://www.analytixlabs.co.in/brochure.pdf", ctx, { approvedEmail: APPROVED });
    expect(kept.text).toContain("analytixlabs.co.in/brochure.pdf");
  });

  it("defers an invented phone, keeps an approved one", () => {
    const invented = enforceGrounding("Call us at +91 90000 11111 anytime.", "", { approvedPhones: ["+91 9876500104"] });
    expect(invented.text).not.toContain("90000");
    expect(invented.actions.some(a => a.cls === "PHONE")).toBe(true);
    const approved = enforceGrounding("Call us at +91 9876500104 anytime.", "", { approvedPhones: ["+91 9876500104"] });
    expect(approved.text).toContain("9876500104");
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

describe("GroundingFirewall — coherent, on-topic deferrals (the 'duration answered as fees' fix)", () => {
  it("names the deferral after what the customer ASKED, not the stray token that tripped it", () => {
    // Duration question; the model fabricated a fee. The deferral must read 'duration', not 'fees'.
    const r = enforceGrounding("Our fee is around ₹49,999 for that.", "", { questionHint: "what is the course duration?" });
    expect(r.text).toContain("duration");
    expect(r.text).not.toContain("49,999");
    expect(r.text).not.toMatch(/exact fees/);
  });

  it("keeps the grounded answer first and puts the deferral LAST (no leading off-topic deferral)", () => {
    const ctx = "[1] The program covers Excel, SQL, Python, and BI tools with hands-on projects.";
    const reply = "The fee is ₹49,999. It covers Excel, SQL, Python, and BI tools with hands-on projects.";
    const r = enforceGrounding(reply, ctx, { questionHint: "which program is best for me?" });
    expect(r.text).toMatch(/^It covers Excel/);                                       // grounded answer leads
    expect(r.text).not.toContain("49,999");
    expect(r.text.trim()).toMatch(/I couldn't verify the exact fees in the available knowledge base, so I've asked our team to confirm\.$/);  // single deferral trails
  });

  it("collapses several ungrounded sentences into ONE deferral and keeps the benign line", () => {
    const reply = "The fee is ₹49,999. The duration is 8 months. Anything else I can help with?";
    const r = enforceGrounding(reply, "", { questionHint: "fees and duration?" });
    expect((r.text.match(/I couldn't verify/g) ?? []).length).toBe(1);
    expect(r.text).toContain("Anything else I can help with?");
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

// Live bug: the commerce tools read prices straight from the tenant's own
// catalog/cart tables, but the firewall's allow-set was built from the RAG
// context alone — so "That's INR 1299.00" was deleted and the customer got
// "our team will share the exact fees" instead of the real price. llm.ts now
// folds each commerce tool's status line into the guard context, exactly as it
// already did for freshly minted pay links.
describe("GroundingFirewall — commerce tool output is grounded (the vanishing-price bug)", () => {
  const REPLY = "The Vitamin C Glow Serum is INR 1299.00.";

  it("defers a catalog price that reaches it with no supporting context", () => {
    const r = enforceGrounding(REPLY, "");
    expect(r.text).not.toContain("1299");
    expect(r.actions.some(a => a.cls === "CURRENCY")).toBe(true);
  });

  it("keeps it once the tool's own status line is in the guard context", () => {
    const toolStatus = "• Vitamin C Glow Serum — INR 1299.00";
    const r = enforceGrounding(REPLY, `\nFrom our catalog and cart:\n${toolStatus}`);
    expect(r.text).toContain("INR 1299.00");
    expect(r.actions.some(a => a.cls === "CURRENCY")).toBe(false);
  });

  it("still defers a price the tools never quoted, on the same turn", () => {
    const toolStatus = "• Vitamin C Glow Serum — INR 1299.00";
    const r = enforceGrounding("Shipping is INR 250.00 extra.", `\nFrom our catalog and cart:\n${toolStatus}`);
    expect(r.text).not.toContain("250");
  });
});

// 2026-11 AI security audit — bypasses found in the firewall, each pinned.
describe("GroundingFirewall — audit bypasses", () => {
  const CTX = "[1] Apply at https://forms.gle/AbC123 . Brochure: https://acme.example/brochures/ds.pdf . Fee: ₹1,50,000.";

  it("a lookalike of the approved domain is NOT the approved domain", () => {
    const r = enforceGrounding("Pay here: https://evilanalytixlabs.co.in/pay", "", { approvedEmail: APPROVED });
    expect(r.text).not.toContain("evilanalytixlabs");
    // …while a real subdomain still is
    expect(enforceGrounding("Log in: https://lms.analytixlabs.co.in/login", "", { approvedEmail: APPROVED }).text).toContain("lms.analytixlabs.co.in");
  });

  it("a host the context mentions does not license every path on it", () => {
    const r = enforceGrounding("Fill this: https://forms.gle/EVIL999", CTX);
    expect(r.text).not.toContain("forms.gle/EVIL999");
    expect(enforceGrounding("Apply: https://forms.gle/AbC123", CTX).text).toContain("forms.gle/AbC123");
    // a parent page of a grounded link is fine
    expect(enforceGrounding("All brochures: https://acme.example/brochures", CTX).text).toContain("acme.example/brochures");
  });

  it("catches a bare link on a TLD outside the old list of eight", () => {
    for (const link of ["pay-fees.xyz/now", "bit.ly/3abc", "acme-offer.shop"]) {
      expect(enforceGrounding(`Visit ${link} today.`, "").text).not.toContain(link);
    }
  });

  it("does not mistake a technology name for a link", () => {
    const t = "You will learn Node.js, Pandas in main.py and write a README.md.";
    expect(enforceGrounding(t, "").text).toBe(t);
  });

  it("checks fees quoted in lakh and crore — with or without a currency sign", () => {
    expect(enforceGrounding("The fee is 2.5 lakh.", CTX).text).not.toContain("2.5 lakh");
    expect(enforceGrounding("The fee is ₹2 lakh.", CTX).text).not.toContain("2 lakh");
    // the SAME amount in another notation is grounded
    expect(enforceGrounding("The fee is ₹1.5 lakh.", CTX).text).toContain("1.5 lakh");
    expect(enforceGrounding("The fee is Rs 150000.", CTX).text).toContain("150000");
  });

  it("reads Devanagari and other non-ASCII digits as numbers", () => {
    const r = enforceGrounding("फीस ₹४९,९९९ है।", "");
    expect(r.text).not.toContain("४९,९९९");
    expect(r.actions).toContainEqual(expect.objectContaining({ cls: "CURRENCY", disposition: "defer" }));
  });

  it("does not read the end of a word as a currency ('years 5')", () => {
    const t = "Graduates with 2 years 5 projects get priority.";
    expect(enforceGrounding(t, "").actions.filter(a => a.cls === "CURRENCY")).toEqual([]);
  });

  it("abstains with the exact wording, and says the team has been asked", () => {
    const r = enforceGrounding("The fee is ₹99,999.", "", { questionHint: "fees?" });
    expect(r.text).toBe("I couldn't verify the exact fees in the available knowledge base, so I've asked our team to confirm.");
  });
});
