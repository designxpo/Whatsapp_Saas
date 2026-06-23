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

  describe("mid-sentence self-introduction by the agent name", () => {
    it("drops 'I'm <Name>,' but keeps the role clause", () => {
      expect(stripLeadingName("I'm doing great, thanks! 😊 I'm Asha, an admissions assistant for AnalytixLabs. How can I help?", "Asha"))
        .toBe("I'm doing great, thanks! 😊 I'm an admissions assistant for AnalytixLabs. How can I help?");
    });
    it("drops a 'My name is <Name>.' sentence", () => {
      expect(stripLeadingName("My name is Asha. How can I help you today?", "Asha")).toBe("How can I help you today?");
    });
    it("drops 'this is <Name>' and '<Name> here'", () => {
      expect(stripLeadingName("Hi! This is Asha. Welcome!", "Asha")).toBe("Hi! Welcome!");
      expect(stripLeadingName("Asha here, happy to help!", "Asha")).toBe("happy to help!");
    });
    it("does NOT touch a normal 'I'm <adjective>' when it isn't the agent name", () => {
      expect(stripLeadingName("I'm happy to help with our courses!", "Asha")).toBe("I'm happy to help with our courses!");
      expect(stripLeadingName("I'm doing great, thanks for asking!", "Asha")).toBe("I'm doing great, thanks for asking!");
    });
    it("no-ops when no agent name is known", () => {
      expect(stripLeadingName("I'm Asha, your advisor.", null)).toBe("I'm Asha, your advisor.");
    });
  });
});
