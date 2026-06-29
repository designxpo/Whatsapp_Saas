import { describe, it, expect } from "vitest";
import { scrubContactEmails } from "../llm";

// The model invents plausible-but-fake staff/department emails (training@,
// admissions@, support@). Multi-tenant, so the approved inbox is passed in (from
// tenant config); when none is configured the scrub is a no-op.
describe("scrubContactEmails", () => {
  const approved = "info@acme.com";

  it("rewrites a hallucinated department email to the approved inbox", () => {
    expect(scrubContactEmails("Contact training@acme.com for details.", approved)).toBe(
      "Contact info@acme.com for details.",
    );
  });

  it("rewrites every other address on the same domain", () => {
    expect(scrubContactEmails("Email admissions@acme.com or support@acme.com", approved)).toBe(
      "Email info@acme.com or info@acme.com",
    );
  });

  it("leaves the approved email untouched (any case)", () => {
    expect(scrubContactEmails("Reach us at info@acme.com", approved)).toBe("Reach us at info@acme.com");
    expect(scrubContactEmails("Reach us at INFO@acme.com", approved)).toBe("Reach us at INFO@acme.com");
  });

  it("never touches URLs (no @) or off-domain emails", () => {
    expect(scrubContactEmails("Visit lms.acme.com", approved)).toBe("Visit lms.acme.com");
    expect(scrubContactEmails("Your email priya@gmail.com is saved", approved)).toBe("Your email priya@gmail.com is saved");
  });

  it("is a no-op when no approved email is configured", () => {
    expect(scrubContactEmails("Contact training@acme.com", "")).toBe("Contact training@acme.com");
  });
});
