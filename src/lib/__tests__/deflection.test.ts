import { describe, it, expect } from "vitest";
import { looksLikeDeflection } from "../router/index";

describe("looksLikeDeflection", () => {
  it("flags canned handoffs that withhold the actual answer", () => {
    // The real-world FAQ entries that were shadowing KB fee data.
    expect(looksLikeDeflection("For detailed pricing information, students can contact the admissions team or book a free career consultation.")).toBe(true);
    expect(looksLikeDeflection("To learn about offers, students are encouraged to speak to an admissions counselor.")).toBe(true);
    expect(looksLikeDeflection("An expert counselor will reach out to discuss your profile.")).toBe(true);
    expect(looksLikeDeflection("I'll connect you with our team — someone will get back to you shortly.")).toBe(true);
    expect(looksLikeDeflection("Please connect with our counsellor for details.")).toBe(true);
  });

  it("does NOT flag a real, grounded answer", () => {
    expect(looksLikeDeflection("The Data Science course fee is ₹50,000, payable in 3 EMIs. It runs for 6 months.")).toBe(false);
    expect(looksLikeDeflection("We offer Certified Data Scientist and Generative AI programs, both with placement support.")).toBe(false);
    expect(looksLikeDeflection("Classes are held on weekends, 10 AM–1 PM IST.")).toBe(false);
  });
});
