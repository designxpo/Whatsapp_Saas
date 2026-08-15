import { describe, it, expect } from "vitest";
import { fillVars, flattenForTemplate } from "../mergefields";

// The resolver chatbot flows have always used, now shared with broadcast
// personalization. The flow behaviour is covered by the flowengine tests; these
// lock the properties broadcasts specifically depend on.
describe("fillVars — shared merge-field resolver", () => {
  const contact = { name: "Priya Sharma", phone: "919876543210", email: "priya@example.com", attributes: { city: "Pune", course: "Data Science" } };

  it("leaves text without a {{token}} completely untouched", () => {
    // This is what guarantees an existing campaign sends the exact same bytes.
    const s = "  Hi there,  your order   shipped.  ";
    expect(fillVars(s, contact)).toBe(s);
  });

  it("resolves profile fields and collected attributes", () => {
    expect(fillVars("Hi {{name}} from {{city}}", contact)).toBe("Hi Priya from Pune");
    expect(fillVars("{{fullname}} · {{email}} · {{phone}}", contact)).toBe("Priya Sharma · priya@example.com · 919876543210");
    expect(fillVars("You picked {{course}}", contact)).toBe("You picked Data Science");
  });

  it("sends an unknown token as empty rather than leaking the placeholder", () => {
    expect(fillVars("Hi {{nickname}}!", contact)).toBe("Hi !");
  });

  it("degrades to empty for a recipient with no contact row", () => {
    expect(fillVars("Hi {{name}} from {{city}}", null)).toBe("Hi  from ");
  });

  it("matches attribute names case-insensitively", () => {
    expect(fillVars("{{CITY}}", contact)).toBe("Pune");
  });
});

describe("flattenForTemplate", () => {
  // Meta rejects template parameters containing newlines or tabs, and contact
  // attributes are raw typed answers — so a filled value gets flattened.
  it("collapses newlines, tabs and runs of spaces", () => {
    expect(flattenForTemplate("Flat 3,\nMG Road\t\tPune")).toBe("Flat 3, MG Road Pune");
  });

  it("trims the result", () => {
    expect(flattenForTemplate("  Pune  ")).toBe("Pune");
  });
});
