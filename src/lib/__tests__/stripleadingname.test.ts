import { describe, it, expect } from "vitest";
import { stripLeadingName } from "../llm";

describe("stripLeadingName", () => {
  it("strips the agent's own name prefix", () => {
    expect(stripLeadingName("Maya: Hi there!", "Maya")).toBe("Hi there!");
    expect(stripLeadingName("*Maya*: Hello", "Maya")).toBe("Hello");
  });
  it("strips a name-like prefix even without the agent name", () => {
    expect(stripLeadingName("Riya: Welcome back", null)).toBe("Welcome back");
    expect(stripLeadingName("Sales Bot: How can I help?", null)).toBe("How can I help?");
  });

  // The production leak: a role label, all-caps, with the colon wrapped in bold.
  it("strips role/persona labels (the MAYA SUPPORT leak family)", () => {
    expect(stripLeadingName("MAYA SUPPORT: The Interactive course is great", "Maya")).toBe("The Interactive course is great");
    expect(stripLeadingName("**MAYA SUPPORT:** The course", "Maya")).toBe("The course");
    expect(stripLeadingName("*MAYA SUPPORT:* Hi", "Maya")).toBe("Hi");
    expect(stripLeadingName("MAYA CUSTOMER SUPPORT: Hi", "Maya")).toBe("Hi");
    expect(stripLeadingName("SUPPORT: How can I help", null)).toBe("How can I help");
    expect(stripLeadingName("MAYA SUPPORT:The fee is 50000", "Maya")).toBe("The fee is 50000");
  });

  it("never strips away the whole message", () => {
    expect(stripLeadingName("Support:", null)).toBe("Support:");
  });
  it("keeps common content labels and normal text", () => {
    expect(stripLeadingName("Note: we close at 6pm", null)).toBe("Note: we close at 6pm");
    expect(stripLeadingName("Fees: ₹49,999", null)).toBe("Fees: ₹49,999");
    expect(stripLeadingName("Hello! How can I help?", "Maya")).toBe("Hello! How can I help?");
    expect(stripLeadingName("Step 1: open the app", null)).toBe("Step 1: open the app");
    expect(stripLeadingName("Total: ₹50,000", null)).toBe("Total: ₹50,000");
    expect(stripLeadingName("Contact: hello@x.com", null)).toBe("Contact: hello@x.com");
  });
  it("keeps a content label even if it matches the colon pattern", () => {
    expect(stripLeadingName("Hours: 9 to 6", "Maya")).toBe("Hours: 9 to 6");
  });
  it("leaves text with no leading label untouched", () => {
    expect(stripLeadingName("Your order is confirmed.", "Maya")).toBe("Your order is confirmed.");
  });
});
