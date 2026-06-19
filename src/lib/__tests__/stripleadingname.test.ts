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
  it("keeps common content labels and normal text", () => {
    expect(stripLeadingName("Note: we close at 6pm", null)).toBe("Note: we close at 6pm");
    expect(stripLeadingName("Fees: ₹49,999", null)).toBe("Fees: ₹49,999");
    expect(stripLeadingName("Hello! How can I help?", "Maya")).toBe("Hello! How can I help?");
  });
  it("keeps a content label even if it matches the colon pattern", () => {
    expect(stripLeadingName("Hours: 9 to 6", "Maya")).toBe("Hours: 9 to 6");
  });
  it("leaves text with no leading label untouched", () => {
    expect(stripLeadingName("Your order is confirmed.", "Maya")).toBe("Your order is confirmed.");
  });
});
